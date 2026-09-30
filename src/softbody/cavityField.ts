import { Fn, If, float, instanceIndex, instancedArray, uint, uniform, vec3, vec4 } from 'three/tsl';
import { Vector3 } from 'three';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import { assertRange, type ParticleRange, type ParticleSystem } from '../core/index.js';
import { releaseStorageBuffers } from '../core/particles.js';
import type { Material, MaterialKernels, SolverContext } from '../core/materials.js';
import { cavityOscillator } from './cavityProfile.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface CavityFieldOptions {
  readonly particles: ParticleSystem;
  readonly range: ParticleRange;
  readonly direction: Vector3;
  readonly axisOrigin: Vector3;
  readonly peakRadius: number;
  readonly speedSensitivity: number;
  readonly referenceSpeed: number;
  /** Frequency in the solver's slow-motion time base. */
  readonly naturalFrequency: number;
  readonly dampingRatio: number;
  readonly axisEpsilon: number;
  readonly stiffness?: number;
  readonly permanentRadius?: number;
  readonly channelRate?: number;
  readonly velocityDamping?: number;
}

export interface CavityPassage {
  /** Solver time at which the nose reaches this station; Infinity if unreachable. */
  time: number;
  /** Local radius relative to the entry radius. */
  scale: number;
}

/** Radial, volume-preserving displacement around a stationary flight axis. */
export class CavityField implements Material {
  readonly particles: ParticleSystem;
  private readonly options: CavityFieldOptions;
  private readonly rest: StorageBufferNode<'vec4'>;
  private readonly passage: StorageBufferNode<'vec4'>;
  private readonly schedule: StorageBufferNode<'vec4'>;
  private readonly clock = instancedArray(1, 'float');
  private readonly source = uniform(new Vector3(-1e6, 0, 0));
  private readonly scheduled = uniform(0, 'float');
  private readonly peak: UniformNode<'float', number>;
  private readonly permanent: UniformNode<'float', number>;
  private readonly speedScale = uniform(1, 'float');
  private readonly stiffness: UniformNode<'float', number>;
  private readonly response = uniform(new Vector3());
  private elapsed = 0;

  constructor(options: CavityFieldOptions) {
    assertRange(options.particles, options.range, 'CavityField');
    cavityOscillator(options.naturalFrequency, options.dampingRatio);
    if (!(options.peakRadius > 0) || !Number.isFinite(options.peakRadius))
      throw new Error('CavityField: invalid radius');
    if (!Number.isFinite(options.direction.length()) || options.direction.lengthSq() === 0)
      throw new Error('CavityField: invalid direction');
    this.particles = options.particles;
    this.options = {
      ...options,
      direction: options.direction.clone().normalize(),
      axisOrigin: options.axisOrigin.clone(),
    };
    this.rest = instancedArray(
      new Float32Array(options.particles.positions.value.array as Float32Array),
      'vec4',
    );
    this.passage = instancedArray(options.particles.capacity, 'vec4');
    this.schedule = instancedArray(options.particles.capacity, 'vec4');
    this.peak = uniform(options.peakRadius, 'float');
    this.permanent = uniform(options.permanentRadius ?? 0, 'float');
    this.stiffness = uniform(Math.min(1, Math.max(0, options.stiffness ?? 0.4)), 'float');
    this.setResponse(options.naturalFrequency, options.dampingRatio);
    this.reset();
  }

  /** Sample the same analytic passage schedule used to draw the cavity wall. */
  setPassage(sample: (station: number) => CavityPassage): void {
    const { range, axisOrigin, direction } = this.options;
    const rest = this.rest.value.array as Float32Array;
    const schedule = this.schedule.value.array as Float32Array;
    const p = new Vector3();
    for (let i = range.start; i < range.start + range.count; i++) {
      p.fromArray(rest, i * 4).sub(axisOrigin);
      const entry = sample(p.dot(direction));
      schedule[i * 4] = Number.isFinite(entry.time) ? entry.time : -1;
      schedule[i * 4 + 1] = Math.max(0, entry.scale);
    }
    this.schedule.value.needsUpdate = true;
    this.scheduled.value = 1;
  }

  build(context: SolverContext): MaterialKernels {
    const tick = Fn(() => {
      this.clock.element(uint(0)).addAssign(context.dt);
    })().compute(1);
    return {
      preSolve: [tick, this.buildMarkKernel()],
      solve: [this.buildPushKernel()],
      postSolve: [this.buildDampingKernel(context.dt)],
    };
  }

  advance(dt: number, station: number, speed: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('CavityField: invalid dt');
    (this.clock.value.array as Float32Array)[0] = this.elapsed;
    this.clock.value.needsUpdate = true;
    this.elapsed += dt;
    this.source.value.set(station, this.elapsed, speed);
  }

  reset(): void {
    (this.passage.value.array as Float32Array).fill(-1);
    this.passage.value.needsUpdate = true;
    (this.clock.value.array as Float32Array)[0] = 0;
    this.clock.value.needsUpdate = true;
    this.elapsed = 0;
    this.source.value.set(-1e6, 0, 0);
  }

  setSpeed(speed: number): void {
    this.speedScale.value = Math.max(
      0,
      1 + this.options.speedSensitivity * (speed / this.options.referenceSpeed - 1),
    );
  }
  setPeakRadius(radius: number): void {
    this.peak.value = radius;
  }
  setPermanentRadius(radius: number): void {
    this.permanent.value = radius;
  }
  setResponse(frequency: number, dampingRatio: number): void {
    const { decay, damped, normalization } = cavityOscillator(frequency, dampingRatio);
    this.response.value.set(decay, damped, normalization);
  }
  setStiffness(stiffness: number): void {
    this.stiffness.value = Math.min(1, Math.max(0, stiffness));
  }
  get marks(): StorageBufferNode<'vec4'> {
    return this.passage;
  }
  get time(): number {
    return this.elapsed;
  }

  dispose(): void {
    releaseStorageBuffers(this.particles.renderer, [
      this.rest,
      this.passage,
      this.schedule,
      this.clock,
    ]);
  }

  private buildMarkKernel(): ComputeNode {
    const { range, axisOrigin, direction, axisEpsilon } = this.options;
    const axis = vec3(direction.x, direction.y, direction.z);
    const origin = vec3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
    return Fn(() => {
      const i: Any = instanceIndex.add(uint(range.start));
      const rel: Any = this.rest.element(i).xyz.sub(origin);
      const station: Any = rel.dot(axis);
      const scheduled: Any = this.schedule.element(i);
      const now: Any = this.clock.element(uint(0));
      const prescribed: Any = this.scheduled.greaterThan(0);
      const reached: Any = prescribed.select(
        scheduled.x.greaterThanEqual(0).and(now.greaterThanEqual(scheduled.x)),
        station.greaterThanEqual(0).and(station.lessThanEqual(this.source.x)),
      );
      const mark: Any = this.passage.element(i);
      If(mark.x.lessThan(0).and(reached), () => {
        const radius = rel.sub(axis.mul(station)).length().max(axisEpsilon);
        mark.assign(
          vec4(
            prescribed.select(scheduled.x, now),
            radius,
            prescribed.select(scheduled.y, float(1)),
            float(0),
          ),
        );
      });
    })()
      .compute(range.count)
      .setName('cavityField.mark');
  }

  private buildPushKernel(): ComputeNode {
    const { range, direction, axisOrigin, axisEpsilon } = this.options;
    const axis = vec3(direction.x, direction.y, direction.z);
    const origin = vec3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
    const fallback = new Vector3(0, 1, 0);
    if (Math.abs(direction.y) > 0.9) fallback.set(0, 0, 1);
    fallback.addScaledVector(direction, -fallback.dot(direction)).normalize();
    return Fn(() => {
      const i: Any = instanceIndex.add(uint(range.start));
      const mark: Any = this.passage.element(i);
      If(this.particles.invMass.element(i).greaterThan(0).and(mark.x.greaterThanEqual(0)), () => {
        const age: Any = this.clock.element(uint(0)).sub(mark.x).max(0);
        const pulse: Any = age
          .mul(this.response.x.negate())
          .exp()
          .mul(age.mul(this.response.y).sin())
          .div(this.response.z)
          .max(0);
        const channel: Any = this.permanent.mul(
          float(1).sub(age.mul(-(this.options.channelRate ?? 12)).exp()),
        );
        const radius: Any = channel
          .add(this.peak.mul(this.speedScale).sub(this.permanent).max(0).mul(pulse))
          .mul(mark.z);
        const desired: Any = mark.y.mul(mark.y).add(radius.mul(radius)).sqrt();
        const p: Any = this.particles.predictedPositions.element(i);
        const rel: Any = p.xyz.sub(origin);
        const radial: Any = rel.sub(axis.mul(rel.dot(axis)));
        const rNow: Any = radial.length();
        const outward: Any = rNow
          .lessThan(axisEpsilon)
          .select(vec3(fallback.x, fallback.y, fallback.z), radial.div(rNow.max(axisEpsilon)));
        // A convergent projection to the displaced annulus, never a repeated impulse.
        const correction: Any = desired.sub(rNow).mul(this.stiffness);
        p.xyz.addAssign(outward.mul(correction));
      });
    })()
      .compute(range.count)
      .setName('cavityField.push');
  }

  private buildDampingKernel(dt: UniformNode<'float', number>): ComputeNode {
    const { range, particles } = this.options;
    return Fn(() => {
      const i: Any = instanceIndex.add(uint(range.start));
      const damping = dt.mul(-(this.options.velocityDamping ?? 3)).exp();
      particles.velocities.element(i).xyz.mulAssign(damping);
      particles.angularVelocity.element(i).xyz.mulAssign(damping);
    })()
      .compute(range.count)
      .setName('cavityField.damping');
  }
}

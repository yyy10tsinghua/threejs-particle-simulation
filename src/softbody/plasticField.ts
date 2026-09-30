import { Fn, If, float, instanceIndex, instancedArray, uint, uniform, vec3, vec4 } from 'three/tsl';
import { Vector3 } from 'three';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import { assertRange, type ParticleRange, type ParticleSystem } from '../core/index.js';
import { releaseStorageBuffers } from '../core/particles.js';
import type { Material, MaterialKernels, SolverContext } from '../core/materials.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface PlasticFieldOptions {
  readonly particles: ParticleSystem;
  readonly range: ParticleRange;
  readonly direction: Vector3;
  readonly axisOrigin: Vector3;
  readonly channelRadius: number;
  readonly rate: number;
  readonly axisEpsilon: number;
}

export function createPlasticOffsets(particles: ParticleSystem): StorageBufferNode<'vec4'> {
  return instancedArray(particles.capacity, 'vec4');
}

/** Irreversible radial redistribution, always evaluated from the original material coordinates. */
export class PlasticField implements Material {
  readonly particles: ParticleSystem;
  readonly offsets: StorageBufferNode<'vec4'>;
  private readonly rest: StorageBufferNode<'vec4'>;
  private readonly channel: StorageBufferNode<'float'>;
  private readonly options: PlasticFieldOptions;
  private readonly target: UniformNode<'float', number>;
  private readonly rate: UniformNode<'float', number>;
  private cavityMarks: StorageBufferNode<'vec4'> | undefined;

  constructor(options: PlasticFieldOptions) {
    assertRange(options.particles, options.range, 'PlasticField');
    if (!(options.channelRadius > 0) || !(options.rate > 0))
      throw new Error('PlasticField: radius and rate must be positive');
    this.options = {
      ...options,
      direction: options.direction.clone().normalize(),
      axisOrigin: options.axisOrigin.clone(),
    };
    this.particles = options.particles;
    this.rest = instancedArray(
      new Float32Array(options.particles.positions.value.array as Float32Array),
      'vec4',
    );
    this.offsets = createPlasticOffsets(options.particles);
    this.channel = instancedArray(options.particles.capacity, 'float');
    this.target = uniform(options.channelRadius, 'float');
    this.rate = uniform(options.rate, 'float');
  }

  observe(marks: StorageBufferNode<'vec4'>): void {
    this.cavityMarks = marks;
  }
  setChannelRadius(radius: number): void {
    this.target.value = radius;
  }
  setRate(rate: number): void {
    this.rate.value = rate;
  }

  reset(): void {
    for (const buffer of [this.offsets, this.channel]) {
      (buffer.value.array as Float32Array).fill(0);
      buffer.value.needsUpdate = true;
    }
  }

  dispose(): void {
    releaseStorageBuffers(this.particles.renderer, [this.rest, this.offsets, this.channel]);
  }

  build(context: SolverContext): MaterialKernels {
    if (!this.cavityMarks) throw new Error('PlasticField: call observe() before building');
    const { range, direction, axisOrigin, axisEpsilon } = this.options;
    const marks = this.cavityMarks;
    const axis = vec3(direction.x, direction.y, direction.z);
    const origin = vec3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
    const fallback = new Vector3(0, 1, 0);
    if (Math.abs(direction.y) > 0.9) fallback.set(0, 0, 1);
    fallback.addScaledVector(direction, -fallback.dot(direction)).normalize();
    const flow = Fn(() => {
      const i: Any = instanceIndex.add(uint(range.start));
      const record: Any = marks.element(i);
      If(this.particles.invMass.element(i).greaterThan(0).and(record.x.greaterThanEqual(0)), () => {
        const rel: Any = this.rest.element(i).xyz.sub(origin);
        const radial: Any = rel.sub(axis.mul(rel.dot(axis)));
        const r0: Any = radial.length();
        const outward: Any = r0
          .lessThan(axisEpsilon)
          .select(vec3(fallback.x, fallback.y, fallback.z), radial.div(r0.max(axisEpsilon)));
        const state: Any = this.channel.element(i);
        const blend: Any = float(1).sub(this.rate.mul(context.dt).negate().exp());
        const live: Any = state.add(this.target.mul(record.z).sub(state).mul(blend)).toVar();
        state.assign(live);
        const rTarget: Any = r0.mul(r0).add(live.mul(live)).sqrt();
        this.offsets.element(i).assign(vec4(outward.mul(rTarget.sub(r0)), float(0)));
      });
    })()
      .compute(range.count)
      .setName('plasticField.flow');
    return { postSolve: [flow] };
  }
}

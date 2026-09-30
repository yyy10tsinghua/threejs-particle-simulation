import {
  BoxGeometry,
  Color,
  GridHelper,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  Vector3,
} from 'three';
import {
  CavityField,
  GELATIN_10_PERCENT,
  ParticleSystem,
  PlasticField,
  SimLoop,
  SoftbodyMesh,
  SoftbodySystem,
  dilateAcceleration,
  dilateSpeed,
  perforationVelocity,
  voxelize,
  type ParticleInit,
} from '../../src/index.js';
import { block, platform } from '../runtime/stage.js';
import type { BuildContext, Experiment, Values } from '../types.js';
import { fitRadius, particleView, scaledSubsteps } from './shared.js';
import {
  BallisticShot,
  CAVITY_DAMPING,
  CHANNEL_RATE,
  GEL_CENTER,
  GEL_CROSS,
  GEL_LENGTH,
  MUZZLE_GAP,
  ROUND_SPEC,
  SLOW_MOTION,
} from './ballisticShot.js';
import { CavityMesh } from './cavityMesh.js';

function gelCompliance(softness: number): number {
  return 10 ** (-6 + softness * 2);
}

/** Prescribed axial ballistics and a damped cavity drive a supported GPU soft body. */
export function buildPenetration(ctx: BuildContext, values: Values): Experiment {
  values = { ...values };
  const volume = new BoxGeometry(GEL_LENGTH, GEL_CROSS, GEL_CROSS);
  volume.translate(0, GEL_CENTER.y, 0);
  const radius = fitRadius(
    (particleRadius) => new Array(voxelize(volume, { particleRadius }).count),
    ctx.particles,
    0.009,
  );
  const shape = voxelize(volume, { particleRadius: radius, largestPiece: true });
  volume.dispose();
  const spacing = 2 * radius;
  const invMass = 1 / (values['density']! * spacing ** 3);
  const minY = Math.min(
    ...Array.from({ length: shape.count }, (_, i) => shape.positions[i * 3 + 1]!),
  );
  const initial: ParticleInit[] = Array.from({ length: shape.count }, (_, i) => {
    const x = shape.positions[i * 3]!,
      y = shape.positions[i * 3 + 1]!,
      z = shape.positions[i * 3 + 2]!;
    // The bottom two cradle contacts prevent rigid drift while the bulk can expand.
    const supported = y < minY + radius && Math.abs(Math.abs(x) - 0.25) < spacing * 1.5;
    return { position: [x, y, z], invMass: supported ? 0 : invMass };
  });
  const particles = new ParticleSystem(ctx.renderer, shape.count, radius);
  particles.uploadParticles(initial);
  const range = { start: 0, count: shape.count };
  const gel = new SoftbodySystem(particles, {
    bodies: [
      {
        range,
        surfaceCount: shape.surfaceCount,
        compliance: gelCompliance(values['softness']!),
        edges: shape.edges,
      },
    ],
    shapeMatching: 'local',
    selfCollision: false,
  });
  let shot = new BallisticShot(values['speed']!, values['density']!, values['softness']!);
  const axis = new Vector3(1, 0, 0),
    origin = new Vector3(-GEL_LENGTH / 2, GEL_CENTER.y, 0);
  const cavity = new CavityField({
    particles,
    range,
    direction: axis,
    axisOrigin: origin,
    peakRadius: shot.peakRadius,
    permanentRadius: shot.channelRadius,
    speedSensitivity: 0,
    referenceSpeed: shot.speed,
    naturalFrequency: shot.frequency,
    dampingRatio: CAVITY_DAMPING,
    channelRate: CHANNEL_RATE,
    axisEpsilon: 1e-6,
    stiffness: 0.4,
    velocityDamping: 5,
  });
  cavity.setPassage((station) => shot.passage(station));
  const plastic = new PlasticField({
    particles,
    range,
    direction: axis,
    axisOrigin: origin,
    channelRadius: shot.channelRadius,
    rate: CHANNEL_RATE,
    axisEpsilon: 1e-6,
  });
  plastic.observe(cavity.marks);
  gel.attachPlasticFlow(plastic.offsets);
  const substeps = scaledSubsteps(4, ctx.particles),
    iterations = 3;
  const loop = new SimLoop(particles, {
    substeps,
    iterations,
    gravity: new Vector3(0, -dilateAcceleration(9.81, SLOW_MOTION), 0),
    materials: [gel, cavity, plastic],
    contact: false,
  });

  const geometry = new BoxGeometry(GEL_LENGTH, GEL_CROSS, GEL_CROSS, 40, 12, 12);
  geometry.translate(0, GEL_CENTER.y, 0);
  const gelSource = new MeshStandardMaterial({ color: 0xe6f8eb, roughness: 0.075 });
  const gelMesh = new SoftbodyMesh(gel, 0, geometry, gelSource, {
    transmission: 0.92,
    thickness: GEL_CROSS,
    ior: 1.35,
    roughness: 0.065,
    attenuationDistance: 0.35,
    attenuationColor: new Color(0xc6dcad),
    color: new Color(0xe5efc8),
    opacity: 0.6,
  });
  gelMesh.name = 'ballistic-gel';
  gelMesh.renderOrder = 2;
  gelMesh.castShadow = false;
  const wall = new CavityMesh();
  const jacket = new MeshStandardMaterial({
    color: 0xc98d46,
    metalness: 0.82,
    roughness: 0.23,
    transparent: true,
  });
  const r = ROUND_SPEC.radius * 1.7;
  const bulletGeometry = new LatheGeometry(
    [
      new Vector2(0, -r * 3.8),
      new Vector2(r * 0.9, -r * 3.8),
      new Vector2(r, -r * 3.5),
      new Vector2(r, -r * 1.5),
      new Vector2(r * 0.9, -r),
      new Vector2(r * 0.65, -r * 0.45),
      new Vector2(r * 0.3, -r * 0.12),
      new Vector2(0, 0),
    ],
    32,
  );
  bulletGeometry.rotateZ(-Math.PI / 2);
  const round = new Mesh(bulletGeometry, jacket);
  round.name = 'ballistic-projectile';
  round.renderOrder = 4;
  round.position.set(origin.x - MUZZLE_GAP, GEL_CENTER.y, 0);
  const dots = particleView(particles, { color: 0x67c0b4, radius: radius * 0.55 });
  const base = platform(1.65, 0.7);
  const cradle = new Group();
  for (const x of [-0.25, 0.25])
    cradle.add(block([spacing * 3, 0.072, 0.35], [x, 0.036, 0], 0x536262, 0.008));
  const rearPlate = block([1.48, 0.62, 0.02], [0, 0.31, -0.29], 0x32423f, 0.012);
  rearPlate.castShadow = false;
  const grid = new GridHelper(1.4, 28, 0x586e65, 0x62736e);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(0, 0.31, -0.277);
  grid.scale.z = 0.43;

  let elapsed = 0,
    particlesVisible = false;
  function resetShot(): void {
    shot = new BallisticShot(values['speed']!, values['density']!, values['softness']!);
    elapsed = 0;
    for (let i = 0; i < initial.length; i++) {
      if (initial[i]!.invMass !== 0)
        initial[i] = { ...initial[i]!, invMass: 1 / (values['density']! * spacing ** 3) };
    }
    particles.uploadParticles(initial);
    for (const buffer of [
      particles.rotation,
      particles.predictedRotation,
      particles.angularVelocity,
    ]) {
      const array = buffer.value.array as Float32Array;
      array.fill(0);
      if (buffer !== particles.angularVelocity)
        for (let i = 0; i < particles.capacity; i++) array[i * 4 + 3] = 1;
      buffer.value.needsUpdate = true;
    }
    cavity.reset();
    plastic.reset();
    cavity.setPeakRadius(shot.peakRadius);
    cavity.setPermanentRadius(shot.channelRadius);
    cavity.setResponse(shot.frequency, CAVITY_DAMPING);
    cavity.setPassage((station) => shot.passage(station));
    plastic.setChannelRadius(shot.channelRadius);
    round.position.set(origin.x - MUZZLE_GAP, GEL_CENTER.y, 0);
    round.visible = !particlesVisible;
    Object.assign(round.userData, shot.sample(0), { elapsed: 0 });
    wall.update(shot, 0, -MUZZLE_GAP);
  }

  return {
    particles,
    loop,
    objects: [base, cradle, rearPlate, grid, gelMesh, wall, round, dots],
    particleCount: particles.capacity,
    substeps,
    iterations,
    update(dt) {
      elapsed += dt;
      const state = shot.sample(elapsed);
      round.position.set(origin.x + state.distance, GEL_CENTER.y, 0);
      round.visible = !particlesVisible && state.distance < GEL_LENGTH + 0.55;
      Object.assign(round.userData, state, { elapsed });
      cavity.advance(dt, state.distance, dilateSpeed(state.speed, SLOW_MOTION));
      wall.update(shot, elapsed, state.distance);
      wall.visible = !particlesVisible && wall.visible;
    },
    setParameter(key, value) {
      if (values[key] === value) return;
      values[key] = value;
      if (key === 'softness') gel.setCompliance(0, gelCompliance(value));
      if (key === 'speed' || key === 'softness' || key === 'density') resetShot();
    },
    setParticleView(enabled) {
      particlesVisible = enabled;
      gelMesh.visible = !enabled;
      rearPlate.visible = !enabled;
      grid.visible = !enabled;
      dots.visible = enabled;
      round.visible = !enabled && shot.sample(elapsed).distance < GEL_LENGTH + 0.55;
      wall.visible = !enabled && Number(wall.userData['length'] ?? 0) > 0.001;
    },
    setReflections(enabled) {
      gelMesh.material.envMapIntensity = enabled ? 1 : 0;
      wall.material.envMapIntensity = enabled ? 1.3 : 0;
    },
    dispose() {
      loop.dispose();
      cavity.dispose();
      plastic.dispose();
      gel.disposePlasticFlow();
      particles.dispose();
      gelSource.dispose();
      wall.dispose();
    },
  };
}

export function gelatinV50(): number {
  return perforationVelocity(ROUND_SPEC, GELATIN_10_PERCENT, GEL_LENGTH);
}

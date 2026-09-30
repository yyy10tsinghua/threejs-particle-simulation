import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { instancedArray } from 'three/tsl';
import {
  CavityField,
  PlasticField,
  ParticleSystem,
  SimLoop,
  createParticleRenderer,
} from '../../../src/index.js';
import { cavityOscillator } from '../../../src/softbody/cavityProfile.js';

describe('cavity and permanent material coordinates', () => {
  it('expands after passage, collapses, and leaves unreached particles untouched', async () => {
    const renderer = await createParticleRenderer();
    const particles = new ParticleSystem(renderer, 3, 0.002);
    particles.uploadParticles([
      { position: [0.1, 0.03, 0] },
      { position: [0.1, -0.03, 0] },
      { position: [0.8, 0.03, 0] },
    ]);
    const field = new CavityField({
      particles,
      range: { start: 0, count: 3 },
      direction: new Vector3(1, 0, 0),
      axisOrigin: new Vector3(),
      peakRadius: 0.05,
      permanentRadius: 0.006,
      speedSensitivity: 0,
      referenceSpeed: 400,
      naturalFrequency: 2,
      dampingRatio: 0.28,
      axisEpsilon: 1e-6,
      stiffness: 0.5,
    });
    field.setPassage((station) => ({ time: station < 0.5 ? 1 : Infinity, scale: 1 }));
    const loop = new SimLoop(particles, {
      materials: [field],
      gravity: new Vector3(),
      contact: false,
      substeps: 4,
      iterations: 3,
    });
    try {
      let peak = 0;
      const { peakTime } = cavityOscillator(2, 0.28);
      for (let i = 0; i < 600; i++) {
        field.advance(1 / 60, 0.5, 0);
        await loop.step(1 / 60);
        if (i === 30 || Math.abs((i + 1) / 60 - 1 - peakTime) < 1 / 120) {
          const snap = await particles.readback();
          if (i === 30) expect(snap.positions[1]).toBeCloseTo(0.03, 5);
          else peak = snap.positions[1]!;
        }
      }
      const snap = await particles.readback();
      expect(peak).toBeGreaterThan(0.055);
      expect(snap.positions[1]).toBeCloseTo(Math.hypot(0.03, 0.006), 3);
      expect(snap.positions[5]).toBeLessThan(0);
      expect(snap.positions[9]).toBeCloseTo(0.03, 5);
      expect(Array.from(snap.positions).every(Number.isFinite)).toBe(true);
    } finally {
      loop.dispose();
      field.dispose();
      particles.dispose();
      renderer.dispose();
    }
  }, 30000);

  it('keeps permanent offsets independent of later particle movement', async () => {
    const renderer = await createParticleRenderer();
    const particles = new ParticleSystem(renderer, 1, 0.002);
    particles.uploadParticles([{ position: [0.1, 0.03, 0] }]);
    const field = new PlasticField({
      particles,
      range: { start: 0, count: 1 },
      direction: new Vector3(1, 0, 0),
      axisOrigin: new Vector3(),
      channelRadius: 0.01,
      rate: 1000,
      axisEpsilon: 1e-6,
    });
    field.observe(instancedArray(new Float32Array([0, 0.03, 1, 0]), 'vec4'));
    const loop = new SimLoop(particles, {
      materials: [field],
      gravity: new Vector3(),
      contact: false,
    });
    try {
      await loop.step(0.1);
      const before = new Float32Array(await renderer.getArrayBufferAsync(field.offsets.value));
      particles.uploadParticles([{ position: [0.4, 0.15, 0.08] }]);
      await loop.step(0.1);
      const after = new Float32Array(await renderer.getArrayBufferAsync(field.offsets.value));
      expect(after[1]).toBeCloseTo(Math.hypot(0.03, 0.01) - 0.03, 6);
      expect(Array.from(after)).toEqual(Array.from(before));
      field.reset();
      await loop.step(0.000001);
      const reset = new Float32Array(await renderer.getArrayBufferAsync(field.offsets.value));
      expect(reset[1]).toBeLessThan(after[1]! * 0.01);
    } finally {
      loop.dispose();
      field.dispose();
      particles.dispose();
      renderer.dispose();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createParticleRenderer } from '../../../src/index.js';
import { buildPenetration } from '../../../demo/presets/penetration.js';
import { disposeObjects } from '../../../demo/runtime/stage.js';

describe('ballistic gel scene', () => {
  it.each([150, 400, 750])(
    'remains bounded, settles, and has the correct outcome at %i m/s',
    async (speed) => {
      const renderer = await createParticleRenderer();
      const experiment = buildPenetration(
        { renderer, camera: new PerspectiveCamera(), scene: new Scene(), particles: 6000 },
        { speed, density: 1030, softness: 0.55 },
      );
      try {
        expect(experiment.particleCount).toBeGreaterThan(5000);
        expect(experiment.particleCount).toBeLessThan(7000);
        let maximum = 0;
        for (let i = 0; i < 840; i++) {
          await experiment.update?.(1 / 60, i / 60);
          await experiment.loop.step(1 / 60);
          maximum = Math.max(
            maximum,
            Number(
              experiment.objects.find((o) => o.name === 'ballistic-cavity')!.userData['maxRadius'],
            ),
          );
        }
        const projectile = experiment.objects.find((o) => o.name === 'ballistic-projectile')!;
        const wall = experiment.objects.find((o) => o.name === 'ballistic-cavity')!;
        expect(projectile.userData['phase']).toBe(speed === 750 ? 'exited' : 'stopped');
        expect(maximum).toBeGreaterThan(0.015);
        expect(Number(wall.userData['maxRadius'])).toBeLessThan(maximum * 0.4);
        const snap = await experiment.particles.readback();
        for (let i = 0; i < snap.capacity; i++) {
          expect(Math.abs(snap.positions[i * 4]!)).toBeLessThan(0.43);
          expect(snap.positions[i * 4 + 1]).toBeGreaterThan(0.055);
          expect(snap.positions[i * 4 + 1]).toBeLessThan(0.43);
          expect(Math.abs(snap.positions[i * 4 + 2]!)).toBeLessThan(0.21);
        }
        experiment.setParticleView?.(true);
        await experiment.update?.(1 / 60, 15);
        expect(projectile.visible).toBe(false);
        expect(wall.visible).toBe(false);
        experiment.setParameter('speed', speed === 750 ? 400 : 750);
        await experiment.update?.(1 / 60, 16);
        await experiment.loop.step(1 / 60);
        expect(projectile.userData['phase']).toBe('ready');
        expect(projectile.userData['elapsed']).toBeCloseTo(1 / 60, 8);
        expect(wall.visible).toBe(false);
      } finally {
        experiment.dispose();
        disposeObjects(experiment.objects);
        renderer.dispose();
      }
    },
    60000,
  );
});

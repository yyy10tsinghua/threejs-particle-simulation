import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  ProjectileFlight,
  GELATIN_10_PERCENT,
  penetrationDepth,
  perforationVelocity,
  cavityRadius,
} from '../../../src/softbody/projectile.js';
import { cavityOscillator, cavityPulse } from '../../../src/softbody/cavityProfile.js';
import {
  BallisticShot,
  GEL_LENGTH,
  SHOT_DELAY,
  SLOW_MOTION,
} from '../../../demo/presets/ballisticShot.js';

const spec = { mass: 0.008, radius: 0.0045 };
function flight(speed: number) {
  return new ProjectileFlight({
    speed,
    spec,
    origin: new Vector3(),
    direction: new Vector3(1, 0, 0),
    mediumDepth: GEL_LENGTH,
  });
}

describe('finite gelatin ballistics', () => {
  it('lodges slow rounds and lets fast rounds keep moving after the exit', () => {
    const slow = flight(150),
      fast = flight(750);
    slow.advance(0.1);
    fast.advance(0.1);
    expect(slow.distance).toBeCloseTo(0.14287245, 6);
    expect(slow.currentSpeed).toBe(0);
    expect(fast.distance).toBeGreaterThan(GEL_LENGTH);
    expect(fast.currentSpeed).toBeGreaterThan(0);
    const start = fast.distance,
      residual = fast.currentSpeed;
    fast.advance(0.02);
    expect(fast.distance - start).toBeCloseTo(residual * 0.02, 10);
    expect(fast.currentSpeed).toBe(residual);
  });

  it.each([150, 400, 500, 750])(
    'has exact passage times and frame-independent motion at %i m/s',
    (speed) => {
      const f = flight(speed);
      for (const station of [0.01, Math.min(f.stopDistance * 0.8, 0.7)]) {
        f.reset();
        f.advance(f.timeAtDistance(station));
        expect(f.distance).toBeCloseTo(station, 10);
      }
      const coarse = flight(speed),
        fine = flight(speed);
      coarse.advance(0.009);
      for (let i = 0; i < 90; i++) fine.advance(0.0001);
      expect(fine.distance).toBeCloseTo(coarse.distance, 10);
      expect(fine.currentSpeed).toBeCloseTo(coarse.currentSpeed, 10);
    },
  );

  it('updates the trajectory when reset with a new initial speed', () => {
    const f = flight(400);
    f.advance(0.1);
    expect(f.stopped).toBe(true);
    f.reset(750);
    f.advance(0.1);
    expect(f.distance).toBeCloseTo(
      flight(750).speedAtDistance(GEL_LENGTH) * (0.1 - f.timeAtDistance(GEL_LENGTH)) + GEL_LENGTH,
      8,
    );
    expect(f.stopped).toBe(false);
  });

  it('uses density in the resistance law and inverts the perforation threshold', () => {
    const dense = { ...GELATIN_10_PERCENT, density: 1400 };
    expect(penetrationDepth(spec, dense, 400)).toBeLessThan(
      penetrationDepth(spec, GELATIN_10_PERCENT, 400),
    );
    const threshold = perforationVelocity(spec, GELATIN_10_PERCENT, GEL_LENGTH);
    expect(penetrationDepth(spec, GELATIN_10_PERCENT, threshold)).toBeCloseTo(GEL_LENGTH, 10);
    expect(cavityRadius(spec, GELATIN_10_PERCENT, 0)).toBe(0);
  });
});

describe('shot and cavity timing', () => {
  it('advances continuously in slow motion instead of jumping to the stop depth', () => {
    const shot = new BallisticShot(400);
    expect(shot.sample(SHOT_DELAY).phase).toBe('ready');
    const first = shot.sample(SHOT_DELAY + 1 / 60);
    expect(first.phase).toBe('flight');
    expect(first.distance).toBeLessThan(0);
    let previous = shot.sample(0).distance;
    for (let i = 1; i <= 840; i++) {
      const state = shot.sample(i / 60);
      expect(state.distance - previous).toBeGreaterThanOrEqual(-1e-10);
      expect(state.distance - previous).toBeLessThanOrEqual(400 / SLOW_MOTION / 60 + 1e-9);
      previous = state.distance;
    }
    expect(shot.sample(20).phase).toBe('stopped');
    expect(shot.sample(30).distance).toBeCloseTo(previous, 10);
  });

  it('normalizes the damped peak and returns to a smaller permanent channel', () => {
    const shot = new BallisticShot(400),
      station = 0.25;
    const { peakTime } = cavityOscillator(shot.frequency, 0.28);
    expect(cavityPulse(peakTime, shot.frequency, 0.28)).toBeCloseTo(1, 10);
    const arrival = shot.passage(station).time;
    expect(shot.radiusAt(arrival - 0.001, station)).toBe(0);
    const peak = shot.radiusAt(arrival + peakTime, station);
    const settled = shot.radiusAt(arrival + 15, station);
    expect(peak).toBeGreaterThan(0.025);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(peak * 0.25);
    expect(shot.radiusAt(100, 0.7)).toBe(0);
  });
});

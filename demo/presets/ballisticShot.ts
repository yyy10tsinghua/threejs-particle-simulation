import { Vector3 } from 'three';
import {
  GELATIN_10_PERCENT,
  ProjectileFlight,
  cavityRadius,
} from '../../src/softbody/projectile.js';
import { cavityWallRadius } from '../../src/softbody/cavityProfile.js';
import type { CavityPassage } from '../../src/softbody/cavityField.js';

export const GEL_LENGTH = 0.76;
export const GEL_CROSS = 0.3;
export const GEL_CENTER = new Vector3(0, 0.23, 0);
export const ROUND_SPEC = { mass: 0.008, radius: 0.0045 };
export const SLOW_MOTION = 900;
export const SHOT_DELAY = 0.55;
export const MUZZLE_GAP = 0.3;
export const SHOT_DURATION = 14;
export const CAVITY_DAMPING = 0.28;
export const CHANNEL_RATE = 12;

export type ShotPhase = 'ready' | 'flight' | 'penetrating' | 'stopped' | 'exited';

/** One clock and one passage curve drive the projectile, GPU field, and cavity surface. */
export class BallisticShot {
  readonly flight: ProjectileFlight;
  readonly peakRadius: number;
  readonly channelRadius: number;
  readonly frequency: number;
  readonly entryTime: number;

  constructor(
    readonly speed: number,
    density = 1030,
    softness = 0.55,
  ) {
    const medium = { ...GELATIN_10_PERCENT, density };
    this.flight = new ProjectileFlight({
      origin: new Vector3(-GEL_LENGTH / 2, GEL_CENTER.y, 0),
      direction: new Vector3(1, 0, 0),
      speed,
      spec: ROUND_SPEC,
      medium,
      mediumDepth: GEL_LENGTH,
    });
    this.peakRadius = cavityRadius(ROUND_SPEC, medium, speed);
    this.channelRadius = ROUND_SPEC.radius * 1.25;
    this.frequency = 2.8 - softness * 1.1;
    this.entryTime = SHOT_DELAY + (MUZZLE_GAP / speed) * SLOW_MOTION;
  }

  sample(time: number): { distance: number; speed: number; phase: ShotPhase } {
    if (time <= SHOT_DELAY) return { distance: -MUZZLE_GAP, speed: 0, phase: 'ready' };
    if (time < this.entryTime)
      return {
        distance: -MUZZLE_GAP + (this.speed * (time - SHOT_DELAY)) / SLOW_MOTION,
        speed: this.speed,
        phase: 'flight',
      };
    this.flight.reset();
    this.flight.advance((time - this.entryTime) / SLOW_MOTION);
    const { distance, currentSpeed: speed } = this.flight;
    return {
      distance,
      speed,
      phase: distance >= GEL_LENGTH ? 'exited' : this.flight.stopped ? 'stopped' : 'penetrating',
    };
  }

  passage(station: number): CavityPassage {
    if (station < 0 || station > GEL_LENGTH || station > this.flight.stopDistance)
      return { time: Infinity, scale: 0 };
    const localSpeed = this.flight.speedAtDistance(station);
    const entrance = 0.3 + 0.7 * (1 - Math.exp(-station / 0.045));
    const energy = 0.25 + 0.75 * Math.sqrt(localSpeed / this.speed);
    return {
      time: this.entryTime + this.flight.timeAtDistance(station) * SLOW_MOTION,
      scale: entrance * energy,
    };
  }

  radiusAt(time: number, station: number): number {
    const passage = this.passage(station);
    return (
      passage.scale *
      cavityWallRadius(
        time - passage.time,
        this.peakRadius,
        this.channelRadius,
        CHANNEL_RATE,
        this.frequency,
        CAVITY_DAMPING,
      )
    );
  }
}

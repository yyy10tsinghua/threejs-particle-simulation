import { Vector3 } from 'three';

/** Parameters of the illustrative Poncelet resistance law F = A * (stress + b*v^2). */
export interface GelatinMedium {
  readonly dynamicStress: number;
  readonly density: number;
  readonly dragCoefficient: number;
}

export interface ProjectileSpec {
  readonly mass: number;
  readonly radius: number;
}

export interface ProjectileOptions {
  readonly origin: Vector3;
  readonly direction: Vector3;
  /** Impact velocity, in real metres per second. */
  readonly speed: number;
  readonly medium?: GelatinMedium;
  readonly spec: ProjectileSpec;
  /** Beyond this distance the projectile leaves the medium and coasts in air. */
  readonly mediumDepth?: number;
}

/** Demo calibration: an 8 g, 9 mm projectile at 400 m/s stops at about 0.60 m. */
export const GELATIN_10_PERCENT: GelatinMedium = {
  dynamicStress: 8.524e6,
  density: 1030,
  dragCoefficient: 0.25,
};

function coefficients(spec: ProjectileSpec, medium: GelatinMedium) {
  for (const [name, value] of Object.entries({ ...spec, ...medium })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Projectile: ${name} must be finite and positive, got ${value}`);
    }
  }
  const area = Math.PI * spec.radius ** 2;
  const b = 0.5 * medium.density * medium.dragCoefficient;
  return { lambda: (area * b) / spec.mass, balanceSpeed: Math.sqrt(medium.dynamicStress / b) };
}

export function penetrationDepth(
  spec: ProjectileSpec,
  medium: GelatinMedium,
  speed: number,
): number {
  const { lambda, balanceSpeed } = coefficients(spec, medium);
  if (!Number.isFinite(speed) || speed < 0) throw new Error('Projectile: invalid speed');
  return Math.log1p((speed / balanceSpeed) ** 2) / (2 * lambda);
}

/** Deterministic perforation threshold of this model, not a statistical V50 measurement. */
export function perforationVelocity(
  spec: ProjectileSpec,
  medium: GelatinMedium,
  thickness: number,
): number {
  const { lambda, balanceSpeed } = coefficients(spec, medium);
  if (!Number.isFinite(thickness) || thickness < 0)
    throw new Error('Projectile: invalid thickness');
  return balanceSpeed * Math.sqrt(Math.expm1(2 * lambda * thickness));
}

/** Smooth illustrative cavity scaling; zero energy produces no cavity. */
export function cavityRadius(spec: ProjectileSpec, medium: GelatinMedium, speed: number): number {
  const { balanceSpeed } = coefficients(spec, medium);
  const ratio = Math.max(0, speed) / balanceSpeed;
  return (
    spec.radius *
    (1 + (12 * ratio) / Math.sqrt(1 + ratio * ratio)) *
    (1 - Math.exp(-Math.max(0, speed) / 35))
  );
}

/** Exact axial motion in a finite medium. All times here are real seconds. */
export class ProjectileFlight {
  readonly medium: GelatinMedium;
  readonly spec: ProjectileSpec;
  readonly direction: Vector3;
  readonly origin: Vector3;
  readonly mediumDepth: number;
  private initialSpeed: number;
  private elapsed = 0;
  private travelled = 0;
  private speed = 0;
  private readonly lambda: number;
  private readonly balanceSpeed: number;

  constructor(options: ProjectileOptions) {
    this.medium = { ...(options.medium ?? GELATIN_10_PERCENT) };
    this.spec = { ...options.spec };
    const { lambda, balanceSpeed } = coefficients(this.spec, this.medium);
    this.lambda = lambda;
    this.balanceSpeed = balanceSpeed;
    if (!Number.isFinite(options.direction.length()) || options.direction.lengthSq() === 0) {
      throw new Error('Projectile: direction must be finite and nonzero');
    }
    this.direction = options.direction.clone().normalize();
    this.origin = options.origin.clone();
    this.mediumDepth = options.mediumDepth ?? Infinity;
    if (!(this.mediumDepth > 0)) throw new Error('Projectile: mediumDepth must be positive');
    this.initialSpeed = options.speed;
    this.reset(options.speed);
  }

  get stopDistance(): number {
    return Math.log1p((this.initialSpeed / this.balanceSpeed) ** 2) / (2 * this.lambda);
  }

  get arrestTime(): number {
    return Math.atan(this.initialSpeed / this.balanceSpeed) / (this.lambda * this.balanceSpeed);
  }

  get stopped(): boolean {
    return this.speed === 0;
  }
  get currentSpeed(): number {
    return this.speed;
  }
  get distance(): number {
    return this.travelled;
  }

  perforates(distance: number): boolean {
    return this.stopDistance > distance;
  }

  speedAtDistance(distance: number): number {
    const depth = Math.min(Math.max(0, distance), this.mediumDepth);
    if (depth >= this.stopDistance) return 0;
    const squared =
      (this.initialSpeed ** 2 + this.balanceSpeed ** 2) * Math.exp(-2 * this.lambda * depth) -
      this.balanceSpeed ** 2;
    return Math.sqrt(Math.max(0, squared));
  }

  /** Passage time at an axial station. Infinity means the station is never reached. */
  timeAtDistance(distance: number): number {
    if (distance <= 0) return 0;
    if (distance > this.mediumDepth && this.perforates(this.mediumDepth)) {
      return (
        this.timeAtDistance(this.mediumDepth) +
        (distance - this.mediumDepth) / this.speedAtDistance(this.mediumDepth)
      );
    }
    if (distance > this.stopDistance) return Infinity;
    return (
      (Math.atan(this.initialSpeed / this.balanceSpeed) -
        Math.atan(this.speedAtDistance(distance) / this.balanceSpeed)) /
      (this.lambda * this.balanceSpeed)
    );
  }

  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error('Projectile: dt must be finite and nonnegative');
    this.elapsed += dt;
    if (this.perforates(this.mediumDepth)) {
      const exitTime = this.timeAtDistance(this.mediumDepth);
      if (this.elapsed >= exitTime) {
        this.speed = this.speedAtDistance(this.mediumDepth);
        this.travelled = this.mediumDepth + this.speed * (this.elapsed - exitTime);
        return;
      }
    }
    if (this.elapsed >= this.arrestTime) {
      this.speed = 0;
      this.travelled = this.stopDistance;
      return;
    }
    const theta0 = Math.atan(this.initialSpeed / this.balanceSpeed);
    const theta = theta0 - this.lambda * this.balanceSpeed * this.elapsed;
    this.speed = Math.max(0, this.balanceSpeed * Math.tan(theta));
    this.travelled = Math.log(Math.cos(theta) / Math.cos(theta0)) / this.lambda;
  }

  position(out: Vector3): Vector3 {
    return out.copy(this.direction).multiplyScalar(this.travelled).add(this.origin);
  }

  reset(speed = this.initialSpeed): void {
    if (!Number.isFinite(speed) || speed <= 0)
      throw new Error('Projectile: speed must be finite and positive');
    this.initialSpeed = speed;
    this.elapsed = 0;
    this.travelled = 0;
    this.speed = speed;
  }
}

export function dilateSpeed(speed: number, slowMotion: number): number {
  return speed / slowMotion;
}
export function dilateAcceleration(acceleration: number, slowMotion: number): number {
  return acceleration / slowMotion ** 2;
}

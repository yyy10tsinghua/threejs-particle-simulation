/** Coefficients shared by the GPU constraint and the visible cavity wall. */
export function cavityOscillator(frequency: number, dampingRatio: number) {
  if (!(frequency > 0) || !Number.isFinite(frequency) || !(dampingRatio > 0 && dampingRatio < 1)) {
    throw new Error('Cavity: frequency must be positive and damping ratio in (0, 1)');
  }
  const decay = dampingRatio * frequency;
  const damped = frequency * Math.sqrt(1 - dampingRatio ** 2);
  const peakTime = Math.acos(dampingRatio) / damped;
  const normalization = Math.exp(-decay * peakTime) * Math.sin(damped * peakTime);
  return { decay, damped, peakTime, normalization };
}

export function cavityPulse(age: number, frequency: number, dampingRatio: number): number {
  if (age <= 0 || !Number.isFinite(age)) return 0;
  const { decay, damped, normalization } = cavityOscillator(frequency, dampingRatio);
  return Math.max(0, (Math.exp(-decay * age) * Math.sin(damped * age)) / normalization);
}

export function cavityWallRadius(
  age: number,
  peak: number,
  permanent: number,
  rate: number,
  frequency: number,
  dampingRatio: number,
): number {
  if (age <= 0 || !Number.isFinite(age)) return 0;
  const channel = permanent * (1 - Math.exp(-rate * age));
  return channel + Math.max(0, peak - permanent) * cavityPulse(age, frequency, dampingRatio);
}

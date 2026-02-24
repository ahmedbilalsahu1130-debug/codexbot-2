export function computeEma(values: number[], period: number): number {
  if (values.length < period) {
    throw new Error('Not enough values for EMA');
  }

  const k = 2 / (period + 1);
  let ema = average(values.slice(0, period));

  for (let index = period; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      continue;
    }
    ema = value * k + ema * (1 - k);
  }

  return ema;
}

export function computeEmaSlope(values: number[], period: number, lookbackBars: number): number {
  if (values.length < period + lookbackBars) {
    throw new Error('Not enough values for EMA slope');
  }

  const latest = computeEma(values, period);
  const previous = computeEma(values.slice(0, values.length - lookbackBars), period);

  return (latest - previous) / Math.max(1e-8, previous);
}

function average(values: number[]): number {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

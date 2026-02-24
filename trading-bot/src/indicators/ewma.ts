export function computeEwmaVariance(returns: number[], lambda: number): number {
  if (returns.length === 0) {
    throw new Error('Not enough returns for EWMA variance');
  }

  let variance = returns[0] !== undefined ? returns[0] ** 2 : 0;

  for (let index = 1; index < returns.length; index += 1) {
    const value = returns[index];
    if (value === undefined) {
      continue;
    }
    variance = lambda * variance + (1 - lambda) * value ** 2;
  }

  return variance;
}

export function computeEwmaSigma(returns: number[], lambda: number): number {
  return Math.sqrt(Math.max(0, computeEwmaVariance(returns, lambda)));
}

export function computeSigmaNorm(sigmas: number[], window: number): number {
  if (sigmas.length === 0) {
    throw new Error('No sigma values');
  }

  const latest = sigmas[sigmas.length - 1];
  if (latest === undefined) {
    throw new Error('Missing latest sigma value');
  }

  const sample = sigmas.slice(-window).sort((a, b) => a - b);
  const median = sample[Math.floor(sample.length / 2)] ?? 1e-8;

  return latest / Math.max(median, 1e-8);
}

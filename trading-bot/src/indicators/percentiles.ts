export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) {
    throw new Error('Cannot compute percentile for empty values');
  }

  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;

  for (const current of sorted) {
    if (current <= value) {
      count += 1;
    }
  }

  return (count / sorted.length) * 100;
}

export function computeLogReturns(closes: number[]): number[] {
  const output: number[] = [];

  for (let index = 1; index < closes.length; index += 1) {
    const prev = closes[index - 1];
    const current = closes[index];
    if (prev === undefined || current === undefined || prev <= 0 || current <= 0) {
      continue;
    }

    output.push(Math.log(current / prev));
  }

  return output;
}

export function computeAtr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    throw new Error('Not enough data for ATR');
  }

  const trueRanges: number[] = [];

  for (let index = 1; index < highs.length; index += 1) {
    const high = highs[index];
    const low = lows[index];
    const previousClose = closes[index - 1];

    if (high === undefined || low === undefined || previousClose === undefined) {
      continue;
    }

    const tr = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    trueRanges.push(tr);
  }

  const sample = trueRanges.slice(-period);
  const sum = sample.reduce((acc, value) => acc + value, 0);
  return sum / sample.length;
}

export function computeAtrPct(atr: number, close: number): number {
  if (close <= 0) {
    throw new Error('Close must be positive for ATR%');
  }

  return (atr / close) * 100;
}

import { percentileRank } from './percentiles.js';

export function computeBollingerWidthPct(closes: number[], period = 20, multiplier = 2): number {
  if (closes.length < period) {
    throw new Error('Not enough closes for Bollinger bands');
  }

  const sample = closes.slice(-period);
  const mean = sample.reduce((acc, value) => acc + value, 0) / sample.length;
  const variance = sample.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sample.length;
  const std = Math.sqrt(variance);
  const upper = mean + multiplier * std;
  const lower = mean - multiplier * std;

  return ((upper - lower) / Math.max(1e-8, mean)) * 100;
}

export function computeBollingerWidthPercentile(widthSeries: number[], latestWidth: number): number {
  return percentileRank(widthSeries, latestWidth);
}

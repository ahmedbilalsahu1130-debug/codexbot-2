import { computeAtr } from '../src/indicators/atr.js';
import { computeEma } from '../src/indicators/ema.js';
import { computeEwmaSigma, computeEwmaVariance } from '../src/indicators/ewma.js';

describe('indicators', () => {
  it('computes ATR(14)', () => {
    const highs = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5 + 1);
    const lows = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5 - 1);
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);

    const atr = computeAtr(highs, lows, closes, 14);

    expect(atr).toBeGreaterThan(0);
    expect(Number.isFinite(atr)).toBe(true);
  });

  it('computes EMA', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120];

    const ema = computeEma(closes, 20);

    expect(ema).toBeGreaterThan(100);
    expect(ema).toBeLessThan(121);
  });

  it('computes EWMA variance and sigma', () => {
    const returns = [0.01, -0.005, 0.004, -0.002, 0.007, -0.001, 0.003];
    const variance = computeEwmaVariance(returns, 0.94);
    const sigma = computeEwmaSigma(returns, 0.94);

    expect(variance).toBeGreaterThan(0);
    expect(sigma).toBeCloseTo(Math.sqrt(variance), 10);
  });
});

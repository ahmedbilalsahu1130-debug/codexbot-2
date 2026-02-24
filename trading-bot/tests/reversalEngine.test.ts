import { ReversalEngine, detectRangeBoundary } from '../src/strategy/engines/reversal.js';
import { EventBus } from '../src/events/eventBus.js';

function feature(overrides: Partial<Record<string, number | string>> = {}) {
  return {
    symbol: 'BTCUSDT',
    timeframe: '5m',
    closeTime: Number(overrides.closeTime ?? Date.now()),
    logReturn: 0.001,
    atrPct: Number(overrides.atrPct ?? 0.5),
    ewmaSigma: 0.2,
    sigmaNorm: Number(overrides.sigmaNorm ?? 1),
    volPct5m: 1,
    bbWidthPct: 0.8,
    bbWidthPercentile: 50,
    ema20: 100,
    ema50: 100,
    ema200: 100,
    ema50Slope: 0,
    volumePct: 100,
    volumePercentile: 50
  };
}

function regime(overrides: Partial<Record<string, string | number | boolean>> = {}) {
  return {
    symbol: 'BTCUSDT',
    closeTime5m: Number(overrides.closeTime5m ?? Date.now()),
    regime: (overrides.regime as 'Compression' | 'Trend' | 'Range' | 'ExpansionChaos') ?? 'Range',
    engine: (overrides.engine as 'Breakout' | 'Continuation' | 'Reversal' | 'Defensive') ?? 'Reversal',
    defensive: Boolean(overrides.defensive ?? false)
  };
}

describe('ReversalEngine', () => {
  it('boundary detection is stable', () => {
    const candles = [
      { high: 101, low: 99, close: 100 },
      { high: 102, low: 98, close: 101.9 }
    ];

    const result = detectRangeBoundary(candles, 0.1);

    expect(result.rangeHigh).toBe(102);
    expect(result.rangeLow).toBe(98);
    expect(result.touchedUpper).toBe(true);
    expect(result.touchedLower).toBe(false);
  });

  it('trigger produces plan on boundary reversal confirmation', async () => {
    const now = Date.now() - 60_000;
    const baseCandles = Array.from({ length: 29 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100 + (i % 3) * 0.1,
      closeTime: new Date(now - (30 - i) * 300_000)
    }));

    const reversalCandle = {
      open: 101.2,
      high: 102.2,
      low: 100.4,
      close: 100.7,
      closeTime: new Date(now)
    };

    const prisma = {
      candle: {
        findMany: jest.fn(async () => [reversalCandle, ...baseCandles].reverse())
      }
    };

    const engine = new ReversalEngine({ prisma: prisma as never, eventBus: new EventBus() });
    const result = await engine.evaluate(feature({ closeTime: now, atrPct: 0.7, sigmaNorm: 1.5 }), regime());

    expect(result.triggered).toBe(true);
    if (!result.triggered) return;
    expect(result.plan.side).toBe('Short');
    expect(result.plan.stopPct).toBeCloseTo(0.56, 8);
  });

  it('false triggers are rejected', async () => {
    const now = Date.now() - 60_000;
    const candles = Array.from({ length: 30 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100.1,
      closeTime: new Date(now - (30 - i) * 300_000)
    }));

    const prisma = {
      candle: {
        findMany: jest.fn(async () => [...candles].reverse())
      }
    };

    const engine = new ReversalEngine({ prisma: prisma as never, eventBus: new EventBus() });
    const result = await engine.evaluate(feature({ closeTime: now }), regime());

    expect(result.triggered).toBe(false);
  });
});

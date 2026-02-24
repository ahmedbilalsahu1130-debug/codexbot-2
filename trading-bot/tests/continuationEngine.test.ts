import { ContinuationEngine } from '../src/strategy/engines/continuation.js';
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
    volPct5m: 1.2,
    bbWidthPct: 0.8,
    bbWidthPercentile: 40,
    ema20: Number(overrides.ema20 ?? 100),
    ema50: Number(overrides.ema50 ?? 101),
    ema200: Number(overrides.ema200 ?? 95),
    ema50Slope: 0.01,
    volumePct: 110,
    volumePercentile: 75
  };
}

function regime(overrides: Partial<Record<string, string | number | boolean>> = {}) {
  return {
    symbol: 'BTCUSDT',
    closeTime5m: Number(overrides.closeTime5m ?? Date.now()),
    regime: (overrides.regime as 'Compression' | 'Trend' | 'Range' | 'ExpansionChaos') ?? 'Trend',
    engine: (overrides.engine as 'Breakout' | 'Continuation' | 'Reversal' | 'Defensive') ?? 'Continuation',
    defensive: Boolean(overrides.defensive ?? false)
  };
}

describe('ContinuationEngine', () => {
  it('long vs short bias is set from EMA50 vs EMA200', async () => {
    const now = Date.now() - 60_000;

    const prismaLong = {
      candle: {
        findMany: jest.fn(async () => [
          { close: 100.1, high: 100.2, low: 99.9, closeTime: new Date(now - 300_000) },
          { close: 100.4, high: 100.35, low: 100.0, closeTime: new Date(now) }
        ])
      }
    };

    const engineLong = new ContinuationEngine({ prisma: prismaLong as never, eventBus: new EventBus() });
    const longResult = await engineLong.evaluate(
      feature({ ema50: 101, ema200: 99, ema20: 100, closeTime: now }),
      regime()
    );

    expect(longResult.triggered).toBe(true);
    if (longResult.triggered) {
      expect(longResult.plan.side).toBe('Long');
    }

    const prismaShort = {
      candle: {
        findMany: jest.fn(async () => [
          { close: 99.9, high: 100.1, low: 99.6, closeTime: new Date(now - 300_000) },
          { close: 99.4, high: 99.8, low: 99.55, closeTime: new Date(now) }
        ])
      }
    };

    const engineShort = new ContinuationEngine({ prisma: prismaShort as never, eventBus: new EventBus() });
    const shortResult = await engineShort.evaluate(
      feature({ ema50: 95, ema200: 101, ema20: 99.8, closeTime: now }),
      regime()
    );

    expect(shortResult.triggered).toBe(true);
    if (shortResult.triggered) {
      expect(shortResult.plan.side).toBe('Short');
    }
  });

  it('pullback/trigger logic rejects when setup or confirmation fails', async () => {
    const now = Date.now() - 60_000;
    const prisma = {
      candle: {
        findMany: jest.fn(async () => [
          { close: 103, high: 103.2, low: 102.7, closeTime: new Date(now - 300_000) },
          { close: 103.1, high: 103.15, low: 102.9, closeTime: new Date(now) }
        ])
      }
    };

    const engine = new ContinuationEngine({ prisma: prisma as never, eventBus: new EventBus() });

    const result = await engine.evaluate(
      feature({ ema20: 100, ema50: 101, ema200: 95, closeTime: now }),
      regime()
    );

    expect(result.triggered).toBe(false);
  });

  it('defensive mode blocks trades', async () => {
    const now = Date.now() - 60_000;
    const prisma = {
      candle: {
        findMany: jest.fn(async () => [
          { close: 100.1, high: 100.2, low: 99.9, closeTime: new Date(now - 300_000) },
          { close: 100.4, high: 100.35, low: 100.0, closeTime: new Date(now) }
        ])
      }
    };

    const engine = new ContinuationEngine({ prisma: prisma as never, eventBus: new EventBus() });
    const result = await engine.evaluate(
      feature({ closeTime: now, ema50: 101, ema200: 99, ema20: 100 }),
      regime({ defensive: true })
    );

    expect(result.triggered).toBe(false);
  });
});

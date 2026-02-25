import { BreakoutEngine } from '../src/strategy/engines/breakout.js';
import { EventBus } from '../src/events/eventBus.js';

function feature(overrides: Partial<Record<string, number | string>> = {}) {
  return {
    symbol: 'BTCUSDT',
    timeframe: '1m',
    closeTime: Number(overrides.closeTime ?? Date.now()),
    logReturn: 0.001,
    atrPct: Number(overrides.atrPct ?? 0.4),
    ewmaSigma: 0.2,
    sigmaNorm: Number(overrides.sigmaNorm ?? 1),
    volPct5m: 1,
    bbWidthPct: 0.3,
    bbWidthPercentile: Number(overrides.bbWidthPercentile ?? 20),
    ema20: 100,
    ema50: 101,
    ema200: 99,
    ema50Slope: 0.01,
    volumePct: 110,
    volumePercentile: Number(overrides.volumePercentile ?? 75)
  };
}

function regime(overrides: Partial<Record<string, string | number | boolean>> = {}) {
  return {
    symbol: 'BTCUSDT',
    closeTime5m: Number(overrides.closeTime5m ?? Date.now()),
    regime: (overrides.regime as 'Compression' | 'Trend' | 'Range' | 'ExpansionChaos') ?? 'Compression',
    engine: (overrides.engine as 'Breakout' | 'Continuation' | 'Reversal' | 'Defensive') ?? 'Breakout',
    defensive: Boolean(overrides.defensive ?? false)
  };
}

describe('BreakoutEngine', () => {
  it('eligibility gate rejects defensive or low-volume setups', async () => {
    const prisma = { candle: { findMany: jest.fn(async () => []) } };
    const bus = new EventBus();
    const engine = new BreakoutEngine({ prisma: prisma as never, eventBus: bus });

    const r1 = await engine.evaluate(feature({ volumePercentile: 40 }), regime());
    expect(r1.triggered).toBe(false);

    const r2 = await engine.evaluate(feature(), regime({ defensive: true }));
    expect(r2.triggered).toBe(false);
  });

  it('trigger produces TradePlan with stopPct and leverage clamping', async () => {
    const now = Date.now() - 60_000;
    const closes = [
      100, 100.2, 100.1, 100.3, 100.15, 100.25, 100.2, 100.3, 100.4, 100.45, 100.4, 100.5, 100.45,
      100.5, 100.55, 100.5, 100.6, 100.65, 100.7, 100.75,
      101.2, 101.4
    ];

    const candles = closes.map((close, index) => ({
      close,
      closeTime: new Date(now - (closes.length - index) * 60_000),
      timeframe: '1m',
      symbol: 'BTCUSDT'
    }));

    const prisma = {
      candle: {
        findMany: jest.fn(async () => [...candles].reverse())
      }
    };

    const bus = new EventBus();
    const engine = new BreakoutEngine({
      prisma: prisma as never,
      eventBus: bus,
      config: {
        rangeLookbackBars: 20,
        confirmationBars: 2,
        breakoutBufferPct: 0.01,
        kb: 1.5,
        leverageBase: 12,
        leverageMin: 1,
        leverageMax: 5,
        exchangeMaxLeverage: 4,
        marginPct: 6
      }
    });

    const result = await engine.evaluate(feature({ closeTime: now, atrPct: 0.6, sigmaNorm: 0.25 }), regime());

    expect(result.triggered).toBe(true);
    if (!result.triggered) return;
    expect(result.plan.side).toBe('Long');
    expect(result.plan.stopPct).toBeCloseTo(0.9, 8);
    expect(result.plan.leverage).toBe(4);
    expect(result.plan.marginPct).toBe(6);
  });
});

import {
  assertClosedCandle,
  candleSchema,
  hashObject,
  orderIntentSchema,
  regimeDecisionSchema,
  tradePlanSchema
} from '../src/domain/models.js';

describe('domain models', () => {
  it('validates a correct candle', () => {
    const parsed = candleSchema.parse({
      symbol: 'BTCUSDT',
      timeframe: '5m',
      closeTime: Date.now() - 10_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000
    });

    expect(parsed.symbol).toBe('BTCUSDT');
  });

  it('rejects negative numeric fields', () => {
    const result = tradePlanSchema.safeParse({
      symbol: 'BTCUSDT',
      side: 'Long',
      engine: 'Breakout',
      entryPrice: 100,
      stopPct: -0.5,
      tpModel: 'A',
      leverage: 2,
      marginPct: 5,
      expiresAt: Date.now() + 60_000,
      reason: 'test'
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-finite numeric values', () => {
    const result = candleSchema.safeParse({
      symbol: 'BTCUSDT',
      timeframe: '5m',
      closeTime: Date.now() - 10_000,
      open: Number.NaN,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000
    });

    expect(result.success).toBe(false);
  });

  it('requires price on LIMIT order intents', () => {
    const result = orderIntentSchema.safeParse({
      symbol: 'BTCUSDT',
      side: 'Long',
      type: 'LIMIT',
      qty: 0.5,
      timeoutMs: 10000,
      cancelIfInvalid: true
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid regime decisions', () => {
    const result = regimeDecisionSchema.safeParse({
      symbol: 'BTCUSDT',
      closeTime5m: Date.now() - 10_000,
      regime: 'Trend',
      engine: 'Continuation',
      defensive: false
    });

    expect(result.success).toBe(true);
  });

  it('assertClosedCandle throws when closeTime is in the future', () => {
    expect(() =>
      assertClosedCandle({
        symbol: 'BTCUSDT',
        timeframe: '5m',
        closeTime: Date.now() + 10_000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000
      })
    ).toThrow(/not finalized/i);
  });

  it('hashObject is stable regardless of object key order', () => {
    const a = { x: 1, y: { b: 2, a: 3 } };
    const b = { y: { a: 3, b: 2 }, x: 1 };

    expect(hashObject(a)).toBe(hashObject(b));
  });
});

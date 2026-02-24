import { FeatureService } from '../src/data/featureService.js';
import { EventBus } from '../src/events/eventBus.js';

type CandleRecord = {
  symbol: string;
  timeframe: string;
  closeTime: Date;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function seedCandles(count: number, start: number): CandleRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.3;
    return {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      closeTime: new Date(start + (index + 1) * 60_000),
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index * 5
    };
  });
}

describe('FeatureService integration', () => {
  it('computes and emits features.ready from seeded candles', async () => {
    const candleRows = seedCandles(230, Date.now() - 231 * 60_000);
    const featureRows: unknown[] = [];

    const prisma = {
      candle: {
        findMany: jest.fn(async () => candleRows)
      },
      feature: {
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
          const row = { id: 1, ...create };
          featureRows.push(row);
          return row;
        })
      },
      auditEvent: {
        create: jest.fn(async () => ({}))
      }
    };

    const bus = new EventBus();
    const emitted: unknown[] = [];

    bus.on('features.ready', (payload) => {
      emitted.push(payload);
    });

    const service = new FeatureService({ prisma: prisma as never, eventBus: bus });
    service.subscribe();

    const last = candleRows[candleRows.length - 1];
    if (!last) throw new Error('Missing last candle');

    bus.emit('candle.closed', {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      closeTime: last.closeTime.getTime(),
      open: last.close,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(featureRows).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });
});

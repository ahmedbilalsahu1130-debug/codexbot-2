import { MarketDataService } from '../src/data/marketDataService.js';
import { EventBus } from '../src/events/eventBus.js';

type CandleRow = {
  symbol: string;
  timeframe: string;
  closeTime: Date;
};

function createPrismaMock(initial: CandleRow[] = []) {
  const rows = [...initial];
  const created: unknown[] = [];
  const auditCreated: unknown[] = [];

  return {
    rows,
    created,
    auditCreated,
    client: {
      candle: {
        findUnique: jest.fn(async ({ where }: { where: { symbol_timeframe_closeTime: CandleRow } }) =>
          rows.find(
            (row) =>
              row.symbol === where.symbol_timeframe_closeTime.symbol &&
              row.timeframe === where.symbol_timeframe_closeTime.timeframe &&
              row.closeTime.getTime() === where.symbol_timeframe_closeTime.closeTime.getTime()
          )
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          rows.push({
            symbol: data.symbol as string,
            timeframe: data.timeframe as string,
            closeTime: data.closeTime as Date
          });
          created.push(data);
          return data;
        })
      },
      auditEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditCreated.push(data);
          return data;
        })
      }
    }
  };
}

describe('MarketDataService', () => {
  it('stores candles and emits candle.closed', async () => {
    const prisma = createPrismaMock();
    const bus = new EventBus();

    const emitted: number[] = [];
    bus.on('candle.closed', (payload) => {
      emitted.push(payload.closeTime);
    });

    const mexcClient = {
      publicGet: jest.fn(async () => [
        [0, '100', '110', '95', '105', '1000', Date.now() - 120_000],
        [0, '105', '112', '101', '110', '900', Date.now() - 60_000]
      ])
    };

    const service = new MarketDataService({
      prisma: prisma.client as never,
      eventBus: bus,
      mexcClient: mexcClient as never
    });

    await service.poll(['BTCUSDT'], '1m', 2);

    expect(prisma.created).toHaveLength(2);
    expect(emitted).toHaveLength(2);
  });

  it('does not emit candle.closed for already seen candle', async () => {
    const now = Date.now() - 60_000;
    const prisma = createPrismaMock([
      {
        symbol: 'BTCUSDT',
        timeframe: '1m',
        closeTime: new Date(now)
      }
    ]);
    const bus = new EventBus();
    const emitted: number[] = [];

    bus.on('candle.closed', (payload) => emitted.push(payload.closeTime));

    const mexcClient = {
      publicGet: jest.fn(async () => [[0, '100', '110', '95', '105', '1000', now]])
    };

    const service = new MarketDataService({
      prisma: prisma.client as never,
      eventBus: bus,
      mexcClient: mexcClient as never
    });

    await service.poll(['BTCUSDT'], '1m', 1);

    expect(prisma.created).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('detects gaps and emits audit.event', async () => {
    const prisma = createPrismaMock();
    const bus = new EventBus();
    const auditMessages: string[] = [];

    bus.on('audit.event', (payload) => {
      auditMessages.push(payload.message);
    });

    const base = Date.now() - 300_000;
    const mexcClient = {
      publicGet: jest.fn(async () => [
        [0, '100', '110', '95', '105', '1000', base],
        [0, '105', '112', '101', '110', '900', base + 180_000]
      ])
    };

    const service = new MarketDataService({
      prisma: prisma.client as never,
      eventBus: bus,
      mexcClient: mexcClient as never
    });

    await service.poll(['BTCUSDT'], '1m', 2);

    expect(prisma.auditCreated).toHaveLength(1);
    expect(auditMessages[0]).toMatch(/Gap detected/i);
    expect(prisma.created).toHaveLength(0);
  });
});

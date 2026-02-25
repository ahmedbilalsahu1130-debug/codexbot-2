import { EventBus } from '../src/events/eventBus.js';
import { SystemMetricsService } from '../src/metrics/systemMetricsService.js';

function metricsPrismaMock() {
  let id = 0n;
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    client: {
      systemMetricDaily: {
        findUnique: jest.fn(async ({ where }: { where: { date_regime: { date: Date; regime: string } } }) =>
          rows.find(
            (item) =>
              String(item.regime) === where.date_regime.regime &&
              (item.date as Date).getTime() === where.date_regime.date.getTime()
          ) ?? null
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { id: (id += 1n), ...data };
          rows.push(created);
          return created;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
        findMany: jest.fn(async ({ where }: { where: { date: Date } }) =>
          rows.filter((item) => (item.date as Date).getTime() === where.date.getTime())
        )
      },
      order: {
        findFirst: jest.fn(async () => ({ orderType: 'LIMIT', price: 100 }))
      },
      $queryRaw: jest.fn(async () => [{ ok: 1 }])
    }
  };
}

describe('SystemMetricsService', () => {
  it('aggregates signals, fills, risk blocks, cooldown and defensive duration', async () => {
    const prisma = metricsPrismaMock();
    const bus = new EventBus({ queueEmits: true });
    const service = new SystemMetricsService({ prisma: prisma.client as never, eventBus: bus });
    service.subscribe();

    const t = Date.now();

    bus.emit('signal.generated', {
      tradePlan: {
        symbol: 'BTCUSDT',
        side: 'Long',
        engine: 'Breakout',
        entryPrice: 100,
        stopPct: 0.5,
        tpModel: 'A',
        leverage: 2,
        marginPct: 5,
        paramsVersionId: '1',
        expiresAt: t + 1_000,
        reason: 'ok',
        confidence: 0.5
      },
      feature: {
        symbol: 'BTCUSDT',
        timeframe: '1m',
        closeTime: t,
        logReturn: 0,
        atrPct: 0.5,
        ewmaSigma: 0.1,
        sigmaNorm: 1,
        volPct5m: 1,
        bbWidthPct: 1,
        bbWidthPercentile: 10,
        ema20: 100,
        ema50: 100,
        ema200: 100,
        ema50Slope: 0,
        volumePct: 1,
        volumePercentile: 80
      },
      regime: {
        symbol: 'BTCUSDT',
        closeTime5m: t,
        regime: 'Compression',
        engine: 'Breakout',
        defensive: false
      }
    });

    bus.emit('risk.rejected', {
      plan: {
        symbol: 'BTCUSDT',
        side: 'Long',
        engine: 'Breakout',
        entryPrice: 100,
        stopPct: 0.5,
        tpModel: 'A',
        leverage: 2,
        marginPct: 5,
        paramsVersionId: '1',
        expiresAt: t + 1_000,
        reason: 'cooldown',
        confidence: 0.5
      },
      signal: {} as never,
      reason: 'symbol cooldown active',
      regime: {
        symbol: 'BTCUSDT',
        closeTime5m: t,
        regime: 'Compression',
        engine: 'Breakout',
        defensive: false
      }
    });

    bus.emit('order.filled', {
      id: 'fill-1',
      orderId: '1',
      price: 101,
      qty: 1,
      fee: 0,
      ts: t
    });

    bus.emit('regime.updated', {
      symbol: 'BTCUSDT',
      closeTime5m: t,
      regime: 'ExpansionChaos',
      engine: 'Defensive',
      defensive: true
    });

    bus.emit('regime.updated', {
      symbol: 'BTCUSDT',
      closeTime5m: t + 5 * 60_000,
      regime: 'Trend',
      engine: 'Continuation',
      defensive: false
    });

    const metrics = await service.getDailyMetrics(t);

    expect(metrics.signalsPerRegime.Compression).toBe(1);
    expect(metrics.fillRatio.limit).toBe(1);
    expect(metrics.tradesBlockedByRisk).toBe(1);
    expect(metrics.cooldownActivationCount).toBe(1);
    expect(metrics.defensiveModeDurationMs).toBe(5 * 60_000);
    expect(metrics.averageSlippageBps).toBeCloseTo(100, 6);
  });
});

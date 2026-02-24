import { ExecutionEngine } from '../src/execution/executionEngine.js';

function plan(overrides: Partial<Record<string, number | string>> = {}) {
  return {
    symbol: 'BTCUSDT',
    side: 'Long' as const,
    engine: 'Breakout' as const,
    entryPrice: Number(overrides.entryPrice ?? 100),
    stopPct: 0.4,
    tpModel: 'A' as const,
    leverage: 3,
    marginPct: 5,
    expiresAt: Number(overrides.expiresAt ?? Date.now() + 60_000),
    reason: 'test'
  };
}

function prismaMock() {
  let id = 10n;
  const orders: Array<Record<string, unknown>> = [];
  return {
    orders,
    client: {
      order: {
        findFirst: jest.fn(async ({ where }: { where: { externalId: string } }) =>
          orders.find((item) => item.externalId === where.externalId) ?? null
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { id: (id += 1n), ...data };
          orders.push(created);
          return created;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
          const target = orders.find((item) => item.id === where.id);
          if (target) Object.assign(target, data);
          return target;
        })
      },
      fill: { create: jest.fn(async () => ({})) },
      position: { create: jest.fn(async () => ({})) },
      auditEvent: { create: jest.fn(async () => ({})) }
    }
  };
}

describe('ExecutionEngine', () => {
  it('timeout path cancels when confirmation fails', async () => {
    const prisma = prismaMock();
    const exchange = {
      placeLimit: jest.fn(async () => ({
        id: 'o1',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'OPEN',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      getOrderStatus: jest.fn(async () => ({
        id: 'o1',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'OPEN',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      cancelOrder: jest.fn(async () => ({
        id: 'o1',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'CANCELED',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      placeMarket: jest.fn()
    };

    const engine = new ExecutionEngine({
      prisma: prisma.client as never,
      exchange: exchange as never,
      sleep: async () => undefined
    });

    const result = await engine.execute({
      plan: plan(),
      qty: 1,
      confirmation: async () => false
    });

    expect(result.status).toBe('CANCELED');
    expect(exchange.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it('fallback executes only when confirmation holds', async () => {
    const prisma = prismaMock();
    const exchange = {
      placeLimit: jest.fn(async () => ({
        id: 'o2',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'OPEN',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      getOrderStatus: jest.fn(async () => ({
        id: 'o2',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'OPEN',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      cancelOrder: jest.fn(async () => ({
        id: 'o2',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'CANCELED',
        qty: 1,
        price: 100,
        filledQty: 0,
        createdAt: Date.now()
      })),
      placeMarket: jest.fn(async () => ({
        id: 'o2m',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'MARKET',
        status: 'FILLED',
        qty: 1,
        filledQty: 1,
        avgFillPrice: 101,
        createdAt: Date.now()
      }))
    };

    const engine = new ExecutionEngine({
      prisma: prisma.client as never,
      exchange: exchange as never,
      sleep: async () => undefined,
      config: { fallbackMode: 'MARKET' }
    });

    const noConfirm = await engine.execute({ plan: plan(), qty: 1, confirmation: async () => false });
    expect(noConfirm.status).toBe('CANCELED');

    const yesConfirm = await engine.execute({
      plan: plan({ expiresAt: Date.now() + 120_000 }),
      qty: 1,
      confirmation: async () => true
    });

    expect(yesConfirm.status).toBe('FILLED');
    expect(exchange.placeMarket).toHaveBeenCalledTimes(1);
  });

  it('idempotency prevents duplicate execution for same plan', async () => {
    const prisma = prismaMock();
    const exchange = {
      placeLimit: jest.fn(async () => ({
        id: 'o3',
        symbol: 'BTCUSDT',
        side: 'Long',
        type: 'LIMIT',
        status: 'FILLED',
        qty: 1,
        price: 100,
        filledQty: 1,
        avgFillPrice: 100,
        createdAt: Date.now()
      })),
      getOrderStatus: jest.fn(),
      cancelOrder: jest.fn(),
      placeMarket: jest.fn()
    };

    const engine = new ExecutionEngine({
      prisma: prisma.client as never,
      exchange: exchange as never,
      sleep: async () => undefined
    });

    const first = await engine.execute({ plan: plan(), qty: 1, confirmation: async () => true });
    const second = await engine.execute({ plan: plan(), qty: 1, confirmation: async () => true });

    expect(first.status).toBe('FILLED');
    expect(second.status).toBe('SKIPPED');
    expect(exchange.placeLimit).toHaveBeenCalledTimes(1);
  });
});

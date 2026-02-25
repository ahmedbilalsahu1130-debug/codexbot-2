import pino from 'pino';

import { bootRuntime } from '../src/app/runtime.js';

function prismaMock() {
  return {
    candle: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      count: jest.fn(async () => 0)
    },
    feature: {
      upsert: jest.fn(async () => ({ id: 1n }))
    },
    regimeDecision: {
      upsert: jest.fn(async () => ({}))
    },
    order: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 1n })),
      update: jest.fn(async () => ({}))
    },
    fill: { create: jest.fn(async () => ({})) },
    position: {
      create: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null)
    },
    auditEvent: {
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null)
    },
    paramVersion: {
      findFirst: jest.fn(async () => ({
        id: 1n,
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
        kb: 1,
        ks: 1,
        leverageBandsJson: {},
        cooldownRulesJson: {},
        portfolioCapsJson: {}
      }))
    }
  };
}

describe('runtime', () => {
  it('boots successfully in paper mode', async () => {
    const runtime = await bootRuntime({
      paperMode: true,
      prisma: prismaMock() as never,
      skipEnvLoad: true,
      logger: pino({ enabled: false })
    });

    expect(runtime.eventBus).toBeDefined();
    expect(runtime.executionEngine).toBeDefined();
    expect(runtime.positionManager).toBeDefined();
  });
});

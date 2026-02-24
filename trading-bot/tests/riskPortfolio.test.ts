import { PortfolioService } from '../src/portfolio/portfolioService.js';
import { RiskService, computeQty } from '../src/risk/riskService.js';

const plan = {
  symbol: 'BTCUSDT',
  side: 'Long' as const,
  engine: 'Breakout' as const,
  entryPrice: 100,
  stopPct: 0.4,
  tpModel: 'A' as const,
  leverage: 4,
  marginPct: 5,
  expiresAt: Date.now() + 60_000,
  reason: 'test'
};

const regime = {
  symbol: 'BTCUSDT',
  closeTime5m: Date.now(),
  regime: 'Compression' as const,
  engine: 'Breakout' as const,
  defensive: false
};

describe('RiskService + PortfolioService', () => {
  it('cap enforcement works', async () => {
    const prisma = {
      position: {
        count: jest
          .fn()
          .mockResolvedValueOnce(1) // countOpenBySymbol
          .mockResolvedValueOnce(2), // countOpenTotal
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => [])
      },
      auditEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({}))
      }
    };

    const portfolio = new PortfolioService({
      prisma: prisma as never,
      caps: { maxOpenPositions: 5, maxOpenPositionsDefensive: 2 }
    });
    const risk = new RiskService({ prisma: prisma as never, portfolioService: portfolio });

    const decision = await risk.evaluatePlan(plan, regime);

    expect(decision.status).toBe('REJECT');
    if (decision.status === 'REJECT') {
      expect(decision.reason).toMatch(/symbol/i);
    }
  });

  it('cooldown works deterministically', async () => {
    const now = Date.now();
    const prisma = {
      position: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ closedAt: new Date(now - 30_000) }) // symbol cooldown active
          .mockResolvedValueOnce(null),
        findMany: jest.fn(async () => [])
      },
      auditEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({}))
      }
    };

    const portfolio = new PortfolioService({ prisma: prisma as never });
    const risk = new RiskService({
      prisma: prisma as never,
      portfolioService: portfolio,
      config: { perSymbolCooldownMs: 60_000 }
    });

    const decision = await risk.evaluatePlan(plan, regime, now);

    expect(decision.status).toBe('REJECT');
    if (decision.status === 'REJECT') {
      expect(decision.reason).toContain('cooldown');
    }
  });

  it('qty calculation is correct and normalized', async () => {
    const qty = computeQty(5, 4, 100, 1000);
    expect(qty).toBeCloseTo(2, 8);

    const prisma = {
      position: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(async () => [])
      },
      auditEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({}))
      }
    };

    const portfolio = new PortfolioService({ prisma: prisma as never });
    const risk = new RiskService({
      prisma: prisma as never,
      portfolioService: portfolio,
      config: { qtyStep: 0.01, minQty: 0.01 }
    });

    const decision = await risk.evaluatePlan(
      { ...plan, entryPrice: 99.7, marginPct: 5, leverage: 4 },
      regime,
      Date.now()
    );

    expect(decision.status).toBe('APPROVE');
    if (decision.status === 'APPROVE') {
      expect(decision.qty * 100).toBe(Math.floor(decision.qty * 100));
      expect(decision.qty).toBeGreaterThan(0);
    }
  });
});

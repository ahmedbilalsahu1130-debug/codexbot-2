import type { PrismaClient } from '@prisma/client';

import type { RegimeDecision, TradePlan } from '../domain/models.js';
import { hashObject } from '../domain/models.js';
import type { PortfolioService } from '../portfolio/portfolioService.js';

export type RiskConfig = {
  perSymbolCooldownMs: number;
  perEngineCooldownMs: number;
  minQty: number;
  qtyStep: number;
  maxLeverageDefensive: number;
  maxOpenPositions: number;
  maxOpenPositionsDefensive: number;
};

export type RiskDecision =
  | {
      status: 'APPROVE';
      qty: number;
      finalLeverage: number;
      plan: TradePlan;
    }
  | {
      status: 'REJECT';
      reason: string;
      plan: TradePlan;
    };

export type RiskServiceOptions = {
  prisma: PrismaClient;
  portfolioService?: PortfolioService;
  portfolioService: PortfolioService;
  config?: Partial<RiskConfig>;
};

const DEFAULT_CONFIG: RiskConfig = {
  perSymbolCooldownMs: 5 * 60_000,
  perEngineCooldownMs: 2 * 60_000,
  minQty: 0.001,
  qtyStep: 0.001,
  maxLeverageDefensive: 2,
  maxOpenPositions: 5,
  maxOpenPositionsDefensive: 2
  maxLeverageDefensive: 2
};

export class RiskService {
  private readonly prisma: PrismaClient;
  private readonly config: RiskConfig;
  private portfolioService?: PortfolioService;

  constructor(options: RiskServiceOptions) {
    this.prisma = options.prisma;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.portfolioService = options.portfolioService;
  }

  setPortfolioService(service: PortfolioService): void {
    this.portfolioService = service;
  }

  async evaluatePlan(plan: TradePlan, regime: RegimeDecision, nowMs = Date.now()): Promise<RiskDecision> {
    const openBySymbol = await this.countOpenBySymbol(plan.symbol);
  private readonly portfolioService: PortfolioService;
  private readonly config: RiskConfig;

  constructor(options: RiskServiceOptions) {
    this.prisma = options.prisma;
    this.portfolioService = options.portfolioService;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  async evaluatePlan(plan: TradePlan, regime: RegimeDecision, nowMs = Date.now()): Promise<RiskDecision> {
    const openBySymbol = await this.portfolioService.countOpenBySymbol(plan.symbol);
    if (openBySymbol >= 1) {
      return this.reject(plan, 'max 1 open position per symbol exceeded');
    }

    const openTotal = await this.countOpenTotal();
    const allowedTotal = regime.defensive ? this.config.maxOpenPositionsDefensive : this.config.maxOpenPositions;
    const openTotal = await this.portfolioService.countOpenTotal();
    const allowedTotal = this.portfolioService.getMaxOpenPositions(regime.defensive);
    if (openTotal >= allowedTotal) {
      return this.reject(plan, `max open positions reached (${allowedTotal})`);
    }

    const symbolCooldown = await this.getLatestCloseTsForSymbol(plan.symbol);
    if (symbolCooldown && nowMs - symbolCooldown < this.config.perSymbolCooldownMs) {
      return this.reject(plan, 'symbol cooldown active');
    }

    const engineCooldown = await this.getLatestEngineSignalTs(plan.engine);
    if (engineCooldown && nowMs - engineCooldown < this.config.perEngineCooldownMs) {
      return this.reject(plan, 'engine cooldown active');
    }

    const finalLeverage = regime.defensive
      ? Math.min(plan.leverage, this.config.maxLeverageDefensive)
      : plan.leverage;

    const qtyRaw = computeQty(plan.marginPct, finalLeverage, plan.entryPrice);
    const qty = normalizeQty(qtyRaw, this.config.qtyStep);

    if (qty < this.config.minQty) {
      return this.reject(plan, 'computed qty below minQty');
    }

    const decision: RiskDecision = {
      status: 'APPROVE',
      qty,
      finalLeverage,
      plan
    };

    await this.auditDecision(decision, nowMs, regime);
    return decision;
  }

  private async countOpenBySymbol(symbol: string): Promise<number> {
    if (this.portfolioService) {
      return this.portfolioService.countOpenBySymbol(symbol);
    }

    return this.prisma.position.count({ where: { symbol, state: { in: ['OPEN', 'CLOSING'] } } });
  }

  private async countOpenTotal(): Promise<number> {
    if (this.portfolioService) {
      return this.portfolioService.countOpenTotal();
    }

    return this.prisma.position.count({ where: { state: { in: ['OPEN', 'CLOSING'] } } });
  }

  private async reject(plan: TradePlan, reason: string): Promise<RiskDecision> {
    const decision: RiskDecision = {
      status: 'REJECT',
      reason,
      plan
    };

    await this.auditDecision(decision, Date.now(), null);
    return decision;
  }

  private async getLatestCloseTsForSymbol(symbol: string): Promise<number | null> {
    const row = await this.prisma.position.findFirst({
      where: { symbol, state: 'CLOSED', closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      select: { closedAt: true }
    });

    if (!row?.closedAt) {
      return null;
    }

    return row.closedAt.getTime();
  }

  private async getLatestEngineSignalTs(engine: TradePlan['engine']): Promise<number | null> {
    const row = await this.prisma.auditEvent.findFirst({
      where: {
        step: 'risk.decision',
        message: 'approve'
        category: 'risk_decision',
        action: 'approve'
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true }
    });

    if (!row || !row.metadata || typeof row.metadata !== 'object') {
      return null;
    }

    const metadata = row.metadata as Record<string, unknown>;
    if (metadata.engine !== engine) {
      return null;
    }

    return row.createdAt.getTime();
  }

  private async auditDecision(decision: RiskDecision, nowMs: number, regime: RegimeDecision | null): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        step: 'risk.decision',
        level: decision.status === 'APPROVE' ? 'info' : 'warn',
        message: decision.status === 'APPROVE' ? 'approve' : 'reject',
        reason: decision.status === 'REJECT' ? decision.reason : null,
        inputsHash: hashObject({ plan: decision.plan, nowMs, defensive: regime?.defensive ?? null }),
        outputsHash: hashObject(decision),
        paramsVersionId: 'baseline',
        category: 'risk_decision',
        action: decision.status === 'APPROVE' ? 'approve' : 'reject',
        actor: 'risk_service',
        metadata: {
          ts: nowMs,
          engine: decision.plan.engine,
          symbol: decision.plan.symbol,
          defensive: regime?.defensive ?? null,
          decision
        }
      }
    });
  }
}

export function computeQty(marginPct: number, leverage: number, price: number, equity = 100): number {
  const notional = equity * (marginPct / 100) * leverage;
  return notional / Math.max(price, 1e-8);
}

export function normalizeQty(qty: number, step: number): number {
  const safeStep = Math.max(step, 1e-12);
  const units = Math.floor(qty / safeStep);
  return units * safeStep;
}

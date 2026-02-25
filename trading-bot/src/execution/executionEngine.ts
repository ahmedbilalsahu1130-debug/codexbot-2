import type { PrismaClient } from '@prisma/client';

import type { TradePlan } from '../domain/models.js';
import { hashObject } from '../domain/models.js';
import type { IExchangeExecution } from './exchangeAdapter.js';

export type FallbackMode = 'MARKET' | 'REPLACE_LIMIT';

export type ExecutionConfig = {
  limitTimeoutMs: number;
  fallbackMode: FallbackMode;
  replacementOffsetPct: number;
};

export type ExecuteInput = {
  plan: TradePlan;
  qty: number;
  confirmation: () => Promise<boolean>;
};

export type ExecuteResult =
  | { status: 'FILLED'; orderId: string; fillPrice: number }
  | { status: 'CANCELED'; orderId: string; reason: string }
  | { status: 'SKIPPED'; reason: string; orderId: string };

export type ExecutionEngineOptions = {
  prisma: PrismaClient;
  exchange: IExchangeExecution;
  config?: Partial<ExecutionConfig>;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_CONFIG: ExecutionConfig = {
  limitTimeoutMs: 2_000,
  fallbackMode: 'MARKET',
  replacementOffsetPct: 0.02
};

export class ExecutionEngine {
  private readonly prisma: PrismaClient;
  private readonly exchange: IExchangeExecution;
  private readonly config: ExecutionConfig;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ExecutionEngineOptions) {
    this.prisma = options.prisma;
    this.exchange = options.exchange;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const executionKey = this.executionKey(input.plan);

    const existing = await this.prisma.order.findFirst({ where: { externalId: executionKey } });
    if (existing) {
      return { status: 'SKIPPED', reason: 'plan already executed', orderId: String(existing.id) };
    }

    const limit = await this.exchange.placeLimit({
      symbol: input.plan.symbol,
      side: input.plan.side,
      qty: input.qty,
      price: input.plan.entryPrice,
      clientOrderId: executionKey
    });

    const orderRecord = await this.prisma.order.create({
      data: {
        exchange: 'paper',
        externalId: executionKey,
        symbol: input.plan.symbol,
        side: input.plan.side,
        orderType: 'LIMIT',
        status: limit.status,
        quantity: input.qty,
        price: input.plan.entryPrice,
        submittedAt: new Date()
      }
    });

    if (limit.status === 'FILLED') {
      return this.persistFillAndPosition(orderRecord.id, input.plan, input.qty, limit.avgFillPrice ?? input.plan.entryPrice);
    }

    await this.sleep(this.config.limitTimeoutMs);

    const status = await this.exchange.getOrderStatus(limit.id);
    if (status.status === 'FILLED') {
      return this.persistFillAndPosition(orderRecord.id, input.plan, input.qty, status.avgFillPrice ?? input.plan.entryPrice);
    }

    const stillValid = await input.confirmation();
    if (!stillValid) {
      await this.exchange.cancelOrder(limit.id);
      await this.prisma.order.update({ where: { id: orderRecord.id }, data: { status: 'CANCELED' } });
      await this.audit('execution_cancel', { executionKey, reason: 'confirmation_failed' });
      return { status: 'CANCELED', orderId: String(orderRecord.id), reason: 'signal no longer valid' };
    }

    if (this.config.fallbackMode === 'MARKET') {
      const market = await this.exchange.placeMarket({
        symbol: input.plan.symbol,
        side: input.plan.side,
        qty: input.qty,
        clientOrderId: `${executionKey}-mkt`
      });

      await this.prisma.order.update({ where: { id: orderRecord.id }, data: { status: market.status, orderType: 'MARKET' } });
      return this.persistFillAndPosition(orderRecord.id, input.plan, input.qty, market.avgFillPrice ?? input.plan.entryPrice);
    }

    const replacementPrice =
      input.plan.side === 'Long'
        ? input.plan.entryPrice * (1 + this.config.replacementOffsetPct / 100)
        : input.plan.entryPrice * (1 - this.config.replacementOffsetPct / 100);

    const replaced = await this.exchange.placeLimit({
      symbol: input.plan.symbol,
      side: input.plan.side,
      qty: input.qty,
      price: replacementPrice,
      clientOrderId: `${executionKey}-repl`
    });

    if (replaced.status !== 'FILLED') {
      await this.exchange.cancelOrder(replaced.id);
      await this.prisma.order.update({ where: { id: orderRecord.id }, data: { status: 'CANCELED' } });
      return { status: 'CANCELED', orderId: String(orderRecord.id), reason: 'replacement limit not filled' };
    }

    await this.prisma.order.update({ where: { id: orderRecord.id }, data: { status: 'FILLED' } });
    return this.persistFillAndPosition(orderRecord.id, input.plan, input.qty, replaced.avgFillPrice ?? replacementPrice);
  }

  private async persistFillAndPosition(
    orderId: bigint,
    plan: TradePlan,
    qty: number,
    fillPrice: number
  ): Promise<ExecuteResult> {
    await this.prisma.fill.create({
      data: {
        orderId,
        price: fillPrice,
        quantity: qty,
        fee: 0,
        filledAt: new Date()
      }
    });

    await this.prisma.position.create({
      data: {
        symbol: plan.symbol,
        side: plan.side,
        quantity: qty,
        avgEntry: fillPrice,
        unrealizedPnL: 0,
        openedAt: new Date()
      }
    });

    await this.prisma.order.update({ where: { id: orderId }, data: { status: 'FILLED' } });

    return { status: 'FILLED', orderId: String(orderId), fillPrice };
  }

  private executionKey(plan: TradePlan): string {
    return `exec-${hashObject({ symbol: plan.symbol, side: plan.side, entryPrice: plan.entryPrice, expiresAt: plan.expiresAt, engine: plan.engine })}`;
  }

  private async audit(action: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        step: `execution.${action}`,
        level: 'warn',
        message: action,
        inputsHash: hashObject(metadata),
        outputsHash: hashObject({ action }),
        paramsVersionId: 'baseline',
        category: 'execution',
        action,
        actor: 'execution_engine',
        metadata
      }
    });
  }
}

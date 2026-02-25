import type { AuditService } from '../audit/auditService.js';
import type { OrderIntent, Position, TradePlan } from '../domain/models.js';

export function assertPlanHasParamsVersion(plan: TradePlan): void {
  if (!plan.paramsVersionId) {
    throw new Error('ParamGuard: TradePlan.paramsVersionId is required');
  }
}

export function buildOrderIntentFromPlan(input: {
  plan: TradePlan;
  qty: number;
  type: 'LIMIT' | 'MARKET';
  timeoutMs: number;
  cancelIfInvalid: boolean;
  price?: number;
}): OrderIntent {
  assertPlanHasParamsVersion(input.plan);

  return {
    symbol: input.plan.symbol,
    side: input.plan.side,
    type: input.type,
    price: input.price,
    qty: input.qty,
    paramsVersionId: input.plan.paramsVersionId,
    timeoutMs: input.timeoutMs,
    cancelIfInvalid: input.cancelIfInvalid
  };
}

export function toPositionFromFill(input: {
  id: string;
  plan: TradePlan;
  qty: number;
  stopPrice: number;
  openedAtMs: number;
}): Position {
  assertPlanHasParamsVersion(input.plan);

  return {
    id: input.id,
    symbol: input.plan.symbol,
    side: input.plan.side,
    entryPrice: input.plan.entryPrice,
    qty: input.qty,
    stopPrice: input.stopPrice,
    state: 'OPEN',
    realizedR: 0,
    remainingQty: input.qty,
    paramsVersionId: input.plan.paramsVersionId,
    openedAt: input.openedAtMs,
    updatedAt: input.openedAtMs
  };
}

export async function auditParamDrift(input: {
  auditService: AuditService;
  positionId: string;
  symbol: string;
  positionParamsVersionId: string;
  activeParamsVersionId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (input.positionParamsVersionId === input.activeParamsVersionId) {
    return;
  }

  await input.auditService.log({
    step: 'param_guard.drift',
    level: 'warn',
    message: 'params version changed mid-position',
    reason: 'params_drift',
    inputs: {
      positionId: input.positionId,
      symbol: input.symbol,
      positionParamsVersionId: input.positionParamsVersionId,
      activeParamsVersionId: input.activeParamsVersionId
    },
    outputs: { status: 'warning' },
    paramsVersionId: input.positionParamsVersionId,
    metadata: input.metadata ?? {}
  });
}

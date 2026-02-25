import type { TradePlan } from '../domain/models.js';
import { tradePlanSchema } from '../domain/models.js';

export type PlanBuildInput = {
  symbol: string;
  side: 'Long' | 'Short';
  engine: TradePlan['engine'];
  entryPrice: number;
  stopPct: number;
  tpModel?: TradePlan['tpModel'];
  leverage: number;
  marginPct: number;
  reason: string;
  confidence?: number;
  nowMs?: number;
  expiryMs?: number;
};

const DEFAULT_EXPIRY_MS = 5 * 60_000;

export function buildTradePlan(input: PlanBuildInput): TradePlan {
  const now = input.nowMs ?? Date.now();
  const expiresAt = now + (input.expiryMs ?? DEFAULT_EXPIRY_MS);

  return tradePlanSchema.parse({
    symbol: input.symbol,
    side: input.side,
    engine: input.engine,
    entryPrice: input.entryPrice,
    stopPct: input.stopPct,
    tpModel: input.tpModel ?? 'A',
    leverage: input.leverage,
    marginPct: input.marginPct,
    expiresAt,
    reason: input.reason,
    confidence: input.confidence ?? 0.6
    reason: input.reason
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

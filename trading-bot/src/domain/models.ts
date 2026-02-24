import { createHash } from 'node:crypto';

import { z } from 'zod';

const finiteNonNegativeNumber = z.number().finite().nonnegative();
const epochMsSchema = z.number().int().nonnegative();
const nonEmptyString = z.string().min(1);

/**
 * Example:
 * {
 *   "symbol": "BTCUSDT",
 *   "timeframe": "5m",
 *   "closeTime": 1734303000000,
 *   "open": 104200.5,
 *   "high": 104410.2,
 *   "low": 104120.1,
 *   "close": 104380.9,
 *   "volume": 523.44
 * }
 */
export const candleSchema = z
  .object({
    symbol: nonEmptyString,
    timeframe: nonEmptyString,
    closeTime: epochMsSchema,
    open: finiteNonNegativeNumber,
    high: finiteNonNegativeNumber,
    low: finiteNonNegativeNumber,
    close: finiteNonNegativeNumber,
    volume: finiteNonNegativeNumber
  })
  .strict();

/**
 * Example:
 * {
 *   "symbol": "BTCUSDT",
 *   "timeframe": "5m",
 *   "closeTime": 1734303000000,
 *   "logReturn": 0.0012,
 *   "atrPct": 0.43,
 *   "ewmaSigma": 0.17,
 *   "sigmaNorm": 0.78,
 *   "volPct5m": 1.05,
 *   "bbWidthPct": 0.64,
 *   "bbWidthPercentile": 82.5,
 *   "ema20": 103990,
 *   "ema50": 103842,
 *   "ema200": 103210,
 *   "ema50Slope": 0.12,
 *   "volumePct": 1.24,
 *   "volumePercentile": 76.3
 * }
 */
export const featureVectorSchema = z
  .object({
    symbol: nonEmptyString,
    timeframe: nonEmptyString,
    closeTime: epochMsSchema,
    logReturn: z.number().finite(),
    atrPct: finiteNonNegativeNumber,
    ewmaSigma: finiteNonNegativeNumber,
    sigmaNorm: finiteNonNegativeNumber,
    volPct5m: finiteNonNegativeNumber,
    bbWidthPct: finiteNonNegativeNumber,
    bbWidthPercentile: finiteNonNegativeNumber.max(100),
    ema20: finiteNonNegativeNumber,
    ema50: finiteNonNegativeNumber,
    ema200: finiteNonNegativeNumber,
    ema50Slope: finiteNonNegativeNumber,
    volumePct: finiteNonNegativeNumber,
    volumePercentile: finiteNonNegativeNumber.max(100)
  })
  .strict();

export const regimeSchema = z.enum(['Compression', 'Trend', 'Range', 'ExpansionChaos']);
export const engineSchema = z.enum(['Breakout', 'Continuation', 'Reversal', 'Defensive']);
export const sideSchema = z.enum(['Long', 'Short']);

/**
 * Example:
 * {
 *   "symbol": "BTCUSDT",
 *   "closeTime5m": 1734303000000,
 *   "regime": "Trend",
 *   "engine": "Continuation",
 *   "defensive": false
 * }
 */
export const regimeDecisionSchema = z
  .object({
    symbol: nonEmptyString,
    closeTime5m: epochMsSchema,
    regime: regimeSchema,
    engine: engineSchema,
    defensive: z.boolean()
  })
  .strict();

export const tpModelSchema = z.enum(['A', 'B']);

/**
 * Example:
 * {
 *   "symbol": "BTCUSDT",
 *   "side": "Long",
 *   "engine": "Breakout",
 *   "entryPrice": 104350,
 *   "stopPct": 0.35,
 *   "tpModel": "A",
 *   "leverage": 3,
 *   "marginPct": 8,
 *   "expiresAt": 1734303600000,
 *   "reason": "validated breakout continuation"
 * }
 */
export const tradePlanSchema = z
  .object({
    symbol: nonEmptyString,
    side: sideSchema,
    engine: engineSchema,
    entryPrice: finiteNonNegativeNumber,
    stopPct: finiteNonNegativeNumber,
    tpModel: tpModelSchema,
    leverage: finiteNonNegativeNumber,
    marginPct: finiteNonNegativeNumber,
    expiresAt: epochMsSchema,
    reason: nonEmptyString
  })
  .strict();

export const orderTypeSchema = z.enum(['LIMIT', 'MARKET']);

/**
 * Example:
 * {
 *   "symbol": "BTCUSDT",
 *   "side": "Long",
 *   "type": "LIMIT",
 *   "price": 104300,
 *   "qty": 0.2,
 *   "timeoutMs": 15000,
 *   "cancelIfInvalid": true
 * }
 */
export const orderIntentSchema = z
  .object({
    symbol: nonEmptyString,
    side: sideSchema,
    type: orderTypeSchema,
    price: finiteNonNegativeNumber.optional(),
    qty: finiteNonNegativeNumber,
    timeoutMs: epochMsSchema,
    cancelIfInvalid: z.boolean()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'LIMIT' && value.price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'price is required when type is LIMIT',
        path: ['price']
      });
    }
  });

export const orderStatusSchema = z.enum(['NEW', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED']);

/**
 * Example:
 * {
 *   "id": "ord_001",
 *   "symbol": "BTCUSDT",
 *   "status": "OPEN",
 *   "type": "LIMIT",
 *   "side": "Long",
 *   "price": 104300,
 *   "qty": 0.2,
 *   "createdAt": 1734303000000
 * }
 */
export const orderSchema = z
  .object({
    id: nonEmptyString,
    symbol: nonEmptyString,
    status: orderStatusSchema,
    type: orderTypeSchema,
    side: sideSchema,
    price: finiteNonNegativeNumber.optional(),
    qty: finiteNonNegativeNumber,
    createdAt: epochMsSchema
  })
  .strict();

/**
 * Example:
 * {
 *   "id": "fill_001",
 *   "orderId": "ord_001",
 *   "price": 104305.5,
 *   "qty": 0.1,
 *   "fee": 0.35,
 *   "ts": 1734303015000
 * }
 */
export const fillSchema = z
  .object({
    id: nonEmptyString,
    orderId: nonEmptyString,
    price: finiteNonNegativeNumber,
    qty: finiteNonNegativeNumber,
    fee: finiteNonNegativeNumber,
    ts: epochMsSchema
  })
  .strict();

export const positionStateSchema = z.enum(['OPEN', 'CLOSING', 'CLOSED', 'LIQUIDATED']);

/**
 * Example:
 * {
 *   "id": "pos_001",
 *   "symbol": "BTCUSDT",
 *   "side": "Long",
 *   "entryPrice": 104300,
 *   "qty": 0.2,
 *   "stopPrice": 103900,
 *   "state": "OPEN",
 *   "realizedR": 0,
 *   "remainingQty": 0.2,
 *   "openedAt": 1734303000000,
 *   "updatedAt": 1734303100000
 * }
 */
export const positionSchema = z
  .object({
    id: nonEmptyString,
    symbol: nonEmptyString,
    side: sideSchema,
    entryPrice: finiteNonNegativeNumber,
    qty: finiteNonNegativeNumber,
    stopPrice: finiteNonNegativeNumber,
    state: positionStateSchema,
    realizedR: finiteNonNegativeNumber,
    remainingQty: finiteNonNegativeNumber,
    openedAt: epochMsSchema,
    updatedAt: epochMsSchema
  })
  .strict();

export const auditLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

/**
 * Example:
 * {
 *   "id": "audit_001",
 *   "ts": 1734303000000,
 *   "step": "strategy.evaluate",
 *   "level": "info",
 *   "message": "regime classified",
 *   "inputsHash": "9dbb9f...",
 *   "outputsHash": "a0d1f2...",
 *   "paramsVersionId": "params_v1",
 *   "metadata": { "symbol": "BTCUSDT" }
 * }
 */
export const auditEventSchema = z
  .object({
    id: nonEmptyString,
    ts: epochMsSchema,
    step: nonEmptyString,
    level: auditLevelSchema,
    message: nonEmptyString,
    inputsHash: nonEmptyString,
    outputsHash: nonEmptyString,
    paramsVersionId: nonEmptyString,
    metadata: z.record(z.string(), z.unknown())
  })
  .strict();

/**
 * Example:
 * {
 *   "id": "params_v1",
 *   "effectiveFrom": 1734300000000,
 *   "kb": 1.2,
 *   "ks": 0.9,
 *   "leverageBandsJson": "{\"trend\": [2,3,4]}",
 *   "cooldownRulesJson": "{\"lossStreak\": 3}",
 *   "portfolioCapsJson": "{\"maxSymbolExposurePct\": 20}"
 * }
 */
export const paramVersionSchema = z
  .object({
    id: nonEmptyString,
    effectiveFrom: epochMsSchema,
    kb: finiteNonNegativeNumber,
    ks: finiteNonNegativeNumber,
    leverageBandsJson: nonEmptyString,
    cooldownRulesJson: nonEmptyString,
    portfolioCapsJson: nonEmptyString
  })
  .strict();

export type Candle = z.infer<typeof candleSchema>;
export type FeatureVector = z.infer<typeof featureVectorSchema>;
export type RegimeDecision = z.infer<typeof regimeDecisionSchema>;
export type TradePlan = z.infer<typeof tradePlanSchema>;
export type OrderIntent = z.infer<typeof orderIntentSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Fill = z.infer<typeof fillSchema>;
export type Position = z.infer<typeof positionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type ParamVersion = z.infer<typeof paramVersionSchema>;

export function assertClosedCandle(candle: Candle): void {
  const now = Date.now();

  if (candle.closeTime > now) {
    throw new Error(`Candle not finalized: closeTime ${candle.closeTime} is in the future`);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const serialized = entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${serialized.join(',')}}`;
}

export function hashObject(obj: unknown): string {
  const payload = stableStringify(obj);
  return createHash('sha256').update(payload).digest('hex');
}

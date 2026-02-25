import type { PrismaClient } from '@prisma/client';

import type { FeatureVector, RegimeDecision } from '../../domain/models.js';
import type { EventBus } from '../../events/eventBus.js';
import { buildTradePlan, clamp, type PlanBuildInput } from '../planner.js';

export type ReversalEngineConfig = {
  rangeLookbackBars: number;
  boundaryTouchPct: number;
  confirmationBodyPct: number;
  ks: number;
  leverageMin: number;
  leverageMax: number;
  leverageBase: number;
  exchangeMaxLeverage: number;
  sigmaNormMin: number;
  sigmaNormMax: number;
  marginPct: number;
  expiryMs: number;
};

export type ReversalEvaluationResult =
  | { triggered: false; reason: string }
  | { triggered: true; reason: string; plan: ReturnType<typeof buildTradePlan> };

export type ReversalEngineOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  config?: Partial<ReversalEngineConfig>;
};

const DEFAULT_CONFIG: ReversalEngineConfig = {
  rangeLookbackBars: 30,
  boundaryTouchPct: 0.05,
  confirmationBodyPct: 0.04,
  ks: 0.8,
  leverageMin: 1,
  leverageMax: 3,
  leverageBase: 3,
  exchangeMaxLeverage: 5,
  sigmaNormMin: 0.5,
  sigmaNormMax: 2.5,
  marginPct: 3,
  expiryMs: 10 * 60_000
};

export class ReversalEngine {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly config: ReversalEngineConfig;
  private readonly latestRegimeBySymbol = new Map<string, RegimeDecision>();

  constructor(options: ReversalEngineOptions) {
    this.prisma = options.prisma;
    this.eventBus = options.eventBus;
    this.config = {
      ...DEFAULT_CONFIG,
      ...options.config
    };
  }

  subscribe(): void {
    this.eventBus.on('regime.updated', (decision) => {
      this.latestRegimeBySymbol.set(decision.symbol, decision);
    });

    this.eventBus.on('features.ready', async (feature) => {
      if (feature.timeframe !== '5m') {
        return;
      }

      const regime = this.latestRegimeBySymbol.get(feature.symbol);
      if (!regime) {
        return;
      }

      const result = await this.evaluate(feature, regime);
      if (!result.triggered) {
        return;
      }

      this.eventBus.emit('signal.generated', {
        tradePlan: result.plan,
        feature,
        regime
      });
    });
  }

  async evaluate(feature: FeatureVector, regime: RegimeDecision): Promise<ReversalEvaluationResult> {
    if (regime.regime !== 'Range') {
      return { triggered: false, reason: 'regime is not Range' };
    }

    if (regime.defensive) {
      return { triggered: false, reason: 'defensive regime active' };
    }

    const candlesDesc = await this.prisma.candle.findMany({
      where: {
        symbol: feature.symbol,
        timeframe: '5m',
        closeTime: {
          lte: new Date(feature.closeTime)
        }
      },
      orderBy: {
        closeTime: 'desc'
      },
      take: this.config.rangeLookbackBars
    });

    const candles = candlesDesc.reverse();
    if (candles.length < this.config.rangeLookbackBars) {
      return { triggered: false, reason: 'not enough candles for range boundary detection' };
    }

    const boundary = detectRangeBoundary(candles, this.config.boundaryTouchPct);
    if (!boundary.touchedUpper && !boundary.touchedLower) {
      return { triggered: false, reason: 'price has not touched range boundaries' };
    }

    const latest = candles[candles.length - 1];
    if (!latest) {
      return { triggered: false, reason: 'missing latest candle' };
    }

    const open = Number(latest.open);
    const close = Number(latest.close);
    const high = Number(latest.high);
    const low = Number(latest.low);

    const candleBodyPct = Math.abs(close - open) / Math.max(1e-8, open) * 100;

    if (candleBodyPct < this.config.confirmationBodyPct) {
      return { triggered: false, reason: 'reversal confirmation candle body too small' };
    }

    let side: PlanBuildInput['side'] | null = null;

    if (boundary.touchedUpper && close < open && high >= boundary.rangeHigh) {
      side = 'Short';
    }

    if (boundary.touchedLower && close > open && low <= boundary.rangeLow) {
      side = 'Long';
    }

    if (!side) {
      return { triggered: false, reason: 'reversal confirmation pattern not detected' };
    }

    const stopPct = this.config.ks * feature.atrPct;
    const sigmaClamped = clamp(feature.sigmaNorm, this.config.sigmaNormMin, this.config.sigmaNormMax);
    const rawLeverage = this.config.leverageBase / sigmaClamped;
    const engineLeverage = clamp(rawLeverage, this.config.leverageMin, this.config.leverageMax);
    const leverage = clamp(engineLeverage, this.config.leverageMin, this.config.exchangeMaxLeverage);

    const plan = buildTradePlan({
      symbol: feature.symbol,
      side,
      engine: 'Reversal',
      entryPrice: close,
      stopPct,
      leverage,
      marginPct: this.config.marginPct,
      paramsVersionId: 'baseline',
      reason: `range boundary reversal ${side.toLowerCase()} confirmed`,
      nowMs: feature.closeTime,
      expiryMs: this.config.expiryMs,
      tpModel: 'B'
    });

    return {
      triggered: true,
      reason: 'reversal confirmed',
      plan
    };
  }
}

export function detectRangeBoundary(
  candles: Array<{ high: number | string; low: number | string; close: number | string }>,
  boundaryTouchPct: number
): { rangeHigh: number; rangeLow: number; touchedUpper: boolean; touchedLower: boolean } {
  const highs = candles.map((item) => Number(item.high));
  const lows = candles.map((item) => Number(item.low));
  const closes = candles.map((item) => Number(item.close));

  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const latestClose = closes[closes.length - 1] ?? 0;

  const upperThreshold = rangeHigh * (1 - boundaryTouchPct / 100);
  const lowerThreshold = rangeLow * (1 + boundaryTouchPct / 100);

  return {
    rangeHigh,
    rangeLow,
    touchedUpper: latestClose >= upperThreshold,
    touchedLower: latestClose <= lowerThreshold
  };
}

import type { PrismaClient } from '@prisma/client';

import type { FeatureVector, RegimeDecision } from '../../domain/models.js';
import type { EventBus } from '../../events/eventBus.js';
import { buildTradePlan, clamp, type PlanBuildInput } from '../planner.js';

export type LeverageBand = {
  maxSigmaNorm: number;
  leverage: number;
};

export type ContinuationEngineConfig = {
  pullbackZonePct: number;
  confirmationBars: number;
  ks: number;
  sigmaNormMin: number;
  sigmaNormMax: number;
  leverageBands: LeverageBand[];
  marginPct: number;
  expiryMs: number;
};

export type ContinuationEvaluationResult =
  | { triggered: false; reason: string }
  | { triggered: true; reason: string; plan: ReturnType<typeof buildTradePlan> };

export type ContinuationEngineOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  config?: Partial<ContinuationEngineConfig>;
};

const DEFAULT_CONFIG: ContinuationEngineConfig = {
  pullbackZonePct: 0.25,
  confirmationBars: 2,
  ks: 0.9,
  sigmaNormMin: 0.25,
  sigmaNormMax: 3,
  leverageBands: [
    { maxSigmaNorm: 0.75, leverage: 6 },
    { maxSigmaNorm: 1.25, leverage: 4 },
    { maxSigmaNorm: 2, leverage: 3 },
    { maxSigmaNorm: 3, leverage: 2 }
  ],
  marginPct: 4,
  expiryMs: 10 * 60_000
};

export class ContinuationEngine {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly config: ContinuationEngineConfig;
  private readonly latestRegimeBySymbol = new Map<string, RegimeDecision>();

  constructor(options: ContinuationEngineOptions) {
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

  async evaluate(feature: FeatureVector, regime: RegimeDecision): Promise<ContinuationEvaluationResult> {
    if (regime.regime !== 'Trend') {
      return { triggered: false, reason: 'regime is not Trend' };
    }

    if (regime.defensive) {
      return { triggered: false, reason: 'defensive regime active' };
    }

    const side: PlanBuildInput['side'] = feature.ema50 >= feature.ema200 ? 'Long' : 'Short';

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
      take: this.config.confirmationBars
    });

    const candles = candlesDesc.reverse();
    if (candles.length < this.config.confirmationBars) {
      return { triggered: false, reason: 'not enough candles for continuation confirmation' };
    }

    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    if (!latest || !previous) {
      return { triggered: false, reason: 'missing confirmation candles' };
    }

    const latestClose = Number(latest.close);
    const previousHigh = Number(previous.high);
    const previousLow = Number(previous.low);

    if (!isInPullbackZone(latestClose, feature.ema20, feature.ema50, this.config.pullbackZonePct)) {
      return { triggered: false, reason: 'pullback zone not satisfied' };
    }

    const confirmed =
      side === 'Long' ? latestClose > previousHigh && latestClose > feature.ema20 : latestClose < previousLow && latestClose < feature.ema20;

    if (!confirmed) {
      return { triggered: false, reason: 'trend resumption confirmation failed' };
    }

    const stopPct = this.config.ks * feature.atrPct;
    const leverage = resolveLeverage(feature.sigmaNorm, this.config);

    const plan = buildTradePlan({
      symbol: feature.symbol,
      side,
      engine: 'Continuation',
      entryPrice: latestClose,
      stopPct,
      leverage,
      marginPct: this.config.marginPct,
      reason: `continuation ${side.toLowerCase()} confirmed after pullback`,
      nowMs: feature.closeTime,
      expiryMs: this.config.expiryMs,
      tpModel: 'B'
    });

    return {
      triggered: true,
      reason: 'continuation confirmed',
      plan
    };
  }
}

function isInPullbackZone(price: number, ema20: number, ema50: number, zonePct: number): boolean {
  const upper = Math.max(ema20, ema50) * (1 + zonePct / 100);
  const lower = Math.min(ema20, ema50) * (1 - zonePct / 100);

  return price >= lower && price <= upper;
}

function resolveLeverage(sigmaNorm: number, config: ContinuationEngineConfig): number {
  const clampedSigma = clamp(sigmaNorm, config.sigmaNormMin, config.sigmaNormMax);

  for (const band of config.leverageBands) {
    if (clampedSigma <= band.maxSigmaNorm) {
      return band.leverage;
    }
  }

  return config.leverageBands[config.leverageBands.length - 1]?.leverage ?? 1;
}

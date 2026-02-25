import type { PrismaClient } from '@prisma/client';

import type { FeatureVector, RegimeDecision } from '../../domain/models.js';
import type { EventBus } from '../../events/eventBus.js';
import { clamp, type PlanBuildInput, buildTradePlan } from '../planner.js';

export type BreakoutEngineConfig = {
  compressionPercentileMax: number;
  volumePercentileMin: number;
  rangeLookbackBars: number;
  breakoutBufferPct: number;
  confirmationBars: number;
  kb: number;
  leverageBase: number;
  leverageMin: number;
  leverageMax: number;
  exchangeMaxLeverage: number;
  marginPct: number;
  expiryMs: number;
};

export type BreakoutEvaluationResult =
  | { triggered: false; reason: string }
  | { triggered: true; plan: ReturnType<typeof buildTradePlan>; reason: string };

export type BreakoutEngineOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  config?: Partial<BreakoutEngineConfig>;
};

const DEFAULT_CONFIG: BreakoutEngineConfig = {
  compressionPercentileMax: 35,
  volumePercentileMin: 60,
  rangeLookbackBars: 20,
  breakoutBufferPct: 0.02,
  confirmationBars: 2,
  kb: 1.2,
  leverageBase: 4,
  leverageMin: 1,
  leverageMax: 10,
  exchangeMaxLeverage: 20,
  marginPct: 5,
  expiryMs: 5 * 60_000
};

export class BreakoutEngine {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly config: BreakoutEngineConfig;
  private readonly latestRegimeBySymbol = new Map<string, RegimeDecision>();

  constructor(options: BreakoutEngineOptions) {
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
      if (feature.timeframe !== '1m') {
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

  async evaluate(feature: FeatureVector, regime: RegimeDecision): Promise<BreakoutEvaluationResult> {
    if (regime.regime !== 'Compression') {
      return { triggered: false, reason: 'regime is not Compression' };
    }

    if (regime.defensive) {
      return { triggered: false, reason: 'defensive regime active' };
    }

    if (feature.bbWidthPercentile > this.config.compressionPercentileMax) {
      return { triggered: false, reason: 'compression percentile gate failed' };
    }

    if (feature.volumePercentile < this.config.volumePercentileMin) {
      return { triggered: false, reason: 'volume percentile gate failed' };
    }

    const candlesDesc = await this.prisma.candle.findMany({
      where: {
        symbol: feature.symbol,
        timeframe: '1m',
        closeTime: {
          lte: new Date(feature.closeTime)
        }
      },
      orderBy: {
        closeTime: 'desc'
      },
      take: this.config.rangeLookbackBars + this.config.confirmationBars + 1
    });

    const candles = candlesDesc.reverse();
    if (candles.length < this.config.rangeLookbackBars + this.config.confirmationBars + 1) {
      return { triggered: false, reason: 'not enough candles for range breakout validation' };
    }

    const closes = candles.map((item) => Number(item.close));
    const lastClose = closes[closes.length - 1];

    if (lastClose === undefined) {
      return { triggered: false, reason: 'missing close price' };
    }

    const baseline = closes.slice(0, closes.length - this.config.confirmationBars);
    const recent = closes.slice(-this.config.confirmationBars);

    const rangeHigh = Math.max(...baseline);
    const rangeLow = Math.min(...baseline);

    const upBarrier = rangeHigh * (1 + this.config.breakoutBufferPct / 100);
    const downBarrier = rangeLow * (1 - this.config.breakoutBufferPct / 100);

    const confirmedUp = recent.every((value) => value !== undefined && value > upBarrier);
    const confirmedDown = recent.every((value) => value !== undefined && value < downBarrier);

    if (!confirmedUp && !confirmedDown) {
      return { triggered: false, reason: 'breakout confirmation not met' };
    }

    const side: PlanBuildInput['side'] = confirmedUp ? 'Long' : 'Short';
    const stopPct = this.config.kb * feature.atrPct;

    const rawLeverage = this.config.leverageBase / Math.sqrt(Math.max(feature.sigmaNorm, 1e-8));
    const cappedEngine = clamp(rawLeverage, this.config.leverageMin, this.config.leverageMax);
    const leverage = clamp(cappedEngine, this.config.leverageMin, this.config.exchangeMaxLeverage);

    const plan = buildTradePlan({
      symbol: feature.symbol,
      side,
      engine: 'Breakout',
      entryPrice: lastClose,
      stopPct,
      leverage,
      marginPct: this.config.marginPct,
      paramsVersionId: 'baseline',
      reason: `breakout confirmed above=${confirmedUp} below=${confirmedDown}`,
      nowMs: feature.closeTime,
      expiryMs: this.config.expiryMs
    });

    return { triggered: true, plan, reason: 'breakout confirmed' };
  }
}

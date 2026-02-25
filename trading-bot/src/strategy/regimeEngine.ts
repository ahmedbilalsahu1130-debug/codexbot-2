import type { PrismaClient } from '@prisma/client';

import type { FeatureVector, RegimeDecision } from '../domain/models.js';
import { regimeDecisionSchema } from '../domain/models.js';
import type { EventBus } from '../events/eventBus.js';
import { percentileRank } from '../indicators/percentiles.js';

export type RegimeEngineOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  windowSize?: number;
  defensiveVolumePercentileThreshold?: number;
  compressionPercentileThreshold?: number;
  trendPercentileThreshold?: number;
  expansionPercentileThreshold?: number;
};

type RegimeContext = {
  sigmaNormPct: number;
  bbWidthPctile: number;
  slopeAbsPctile: number;
};

const DEFAULTS = {
  windowSize: 100,
  defensiveVolumePercentileThreshold: 90,
  compressionPercentileThreshold: 25,
  trendPercentileThreshold: 65,
  expansionPercentileThreshold: 85
};

export class RegimeEngine {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly history = new Map<string, FeatureVector[]>();

  private readonly windowSize: number;
  private readonly defensiveVolumePercentileThreshold: number;
  private readonly compressionPercentileThreshold: number;
  private readonly trendPercentileThreshold: number;
  private readonly expansionPercentileThreshold: number;

  constructor(options: RegimeEngineOptions) {
    this.prisma = options.prisma;
    this.eventBus = options.eventBus;
    this.windowSize = options.windowSize ?? DEFAULTS.windowSize;
    this.defensiveVolumePercentileThreshold =
      options.defensiveVolumePercentileThreshold ?? DEFAULTS.defensiveVolumePercentileThreshold;
    this.compressionPercentileThreshold =
      options.compressionPercentileThreshold ?? DEFAULTS.compressionPercentileThreshold;
    this.trendPercentileThreshold = options.trendPercentileThreshold ?? DEFAULTS.trendPercentileThreshold;
    this.expansionPercentileThreshold =
      options.expansionPercentileThreshold ?? DEFAULTS.expansionPercentileThreshold;
  }

  subscribe(): void {
    this.eventBus.on('features.ready', async (feature) => {
      if (feature.timeframe !== '5m') {
        return;
      }

      await this.processFeature(feature);
    });
  }

  async processFeature(feature: FeatureVector): Promise<RegimeDecision> {
    const key = `${feature.symbol}:${feature.timeframe}`;
    const history = this.history.get(key) ?? [];
    history.push(feature);
    if (history.length > this.windowSize) {
      history.shift();
    }
    this.history.set(key, history);

    const context = buildContext(history, feature);
    const classified = classifyRegime(context, {
      compressionPercentileThreshold: this.compressionPercentileThreshold,
      trendPercentileThreshold: this.trendPercentileThreshold,
      expansionPercentileThreshold: this.expansionPercentileThreshold
    });

    const defensive = feature.volumePercentile >= this.defensiveVolumePercentileThreshold;
    const engine = defensive ? 'Defensive' : mapRegimeToEngine(classified);

    const decision = regimeDecisionSchema.parse({
      symbol: feature.symbol,
      closeTime5m: feature.closeTime,
      regime: classified,
      engine,
      defensive
    });

    await this.prisma.regimeDecision.upsert({
      where: {
        symbol_closeTime5m: {
          symbol: decision.symbol,
          closeTime5m: new Date(decision.closeTime5m)
        }
      },
      create: {
        symbol: decision.symbol,
        closeTime5m: new Date(decision.closeTime5m),
        regime: decision.regime,
        engine: decision.engine,
        defensive: decision.defensive
      },
      update: {
        regime: decision.regime,
        engine: decision.engine,
        defensive: decision.defensive
      }
    });

    this.eventBus.emit('regime.updated', decision);
    return decision;
  }
}

export function classifyRegime(
  context: RegimeContext,
  thresholds: {
    compressionPercentileThreshold: number;
    trendPercentileThreshold: number;
    expansionPercentileThreshold: number;
  }
): RegimeDecision['regime'] {
  if (
    context.sigmaNormPct <= thresholds.compressionPercentileThreshold &&
    context.bbWidthPctile <= thresholds.compressionPercentileThreshold
  ) {
    return 'Compression';
  }

  if (
    context.sigmaNormPct >= thresholds.expansionPercentileThreshold &&
    context.bbWidthPctile >= thresholds.expansionPercentileThreshold
  ) {
    return 'ExpansionChaos';
  }

  if (
    context.sigmaNormPct >= thresholds.trendPercentileThreshold &&
    context.slopeAbsPctile >= thresholds.trendPercentileThreshold
  ) {
    return 'Trend';
  }

  return 'Range';
}

export function mapRegimeToEngine(regime: RegimeDecision['regime']): RegimeDecision['engine'] {
  if (regime === 'Compression') {
    return 'Breakout';
  }

  if (regime === 'Trend') {
    return 'Continuation';
  }

  if (regime === 'Range') {
    return 'Reversal';
  }

  return 'Defensive';
}

function buildContext(history: FeatureVector[], latest: FeatureVector): RegimeContext {
  const sigmaSeries = history.map((item) => item.sigmaNorm);
  const widthSeries = history.map((item) => item.bbWidthPct);
  const slopeSeries = history.map((item) => Math.abs(item.ema50Slope));

  return {
    sigmaNormPct: percentileRank(sigmaSeries, latest.sigmaNorm),
    bbWidthPctile: percentileRank(widthSeries, latest.bbWidthPct),
    slopeAbsPctile: percentileRank(slopeSeries, Math.abs(latest.ema50Slope))
  };
}

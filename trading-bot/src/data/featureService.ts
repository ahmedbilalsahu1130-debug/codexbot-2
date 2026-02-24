import type { PrismaClient } from '@prisma/client';

import type { FeatureVector } from '../domain/models.js';
import { featureVectorSchema, hashObject } from '../domain/models.js';
import type { EventBus } from '../events/eventBus.js';
import {
  computeAtr,
  computeAtrPct,
  computeBollingerWidthPercentile,
  computeBollingerWidthPct,
  computeEma,
  computeEmaSlope,
  computeEwmaSigma,
  computeLogReturns,
  computeSigmaNorm,
  percentileRank
} from '../indicators/index.js';

type FeatureServiceOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  sigmaWindow?: number;
  volumeWindow?: number;
  bbWindow?: number;
  candlesWindow?: number;
};

export class FeatureService {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly sigmaWindow: number;
  private readonly volumeWindow: number;
  private readonly bbWindow: number;
  private readonly candlesWindow: number;

  constructor(options: FeatureServiceOptions) {
    this.prisma = options.prisma;
    this.eventBus = options.eventBus;
    this.sigmaWindow = options.sigmaWindow ?? 50;
    this.volumeWindow = options.volumeWindow ?? 50;
    this.bbWindow = options.bbWindow ?? 50;
    this.candlesWindow = options.candlesWindow ?? 260;
  }

  subscribe(): void {
    this.eventBus.on('candle.closed', async (candle) => {
      await this.processClosedCandle(candle.symbol, candle.timeframe, candle.closeTime);
    });
  }

  async processClosedCandle(symbol: string, timeframe: string, closeTime: number): Promise<void> {
    const candlesDesc = await this.prisma.candle.findMany({
      where: {
        symbol,
        timeframe,
        closeTime: {
          lte: new Date(closeTime)
        }
      },
      orderBy: {
        closeTime: 'desc'
      },
      take: this.candlesWindow
    });

    const candles = candlesDesc.reverse();

    if (candles.length < 205) {
      return;
    }

    const highs = candles.map((item) => Number(item.high));
    const lows = candles.map((item) => Number(item.low));
    const closes = candles.map((item) => Number(item.close));
    const volumes = candles.map((item) => Number(item.volume));

    const returns = computeLogReturns(closes);
    if (returns.length < 30) {
      return;
    }

    const lambda = timeframe === '5m' ? 0.97 : 0.94;
    const latestClose = closes[closes.length - 1];
    const latestVolume = volumes[volumes.length - 1];

    if (latestClose === undefined || latestVolume === undefined) {
      return;
    }

    const atr = computeAtr(highs, lows, closes, 14);
    const atrPct = computeAtrPct(atr, latestClose);
    const sigmaSeries = buildSigmaSeries(returns, lambda);
    const ewmaSigma = sigmaSeries[sigmaSeries.length - 1] ?? 0;
    const sigmaNorm = computeSigmaNorm(sigmaSeries, this.sigmaWindow);

    const bbWidthSeries = buildBbWidthSeries(closes, 20);
    const bbWidthPct = bbWidthSeries[bbWidthSeries.length - 1] ?? 0;
    const bbWidthPercentile = computeBollingerWidthPercentile(bbWidthSeries.slice(-this.bbWindow), bbWidthPct);

    const ema20 = computeEma(closes, 20);
    const ema50 = computeEma(closes, 50);
    const ema200 = computeEma(closes, 200);
    const ema50Slope = computeEmaSlope(closes, 50, 5);

    const recentVolumes = volumes.slice(-this.volumeWindow);
    const volumePercentile = percentileRank(recentVolumes, latestVolume);
    const medianVolume = median(recentVolumes);
    const volumePct = (latestVolume / Math.max(1e-8, medianVolume)) * 100;

    const latestReturn = returns[returns.length - 1] ?? 0;
    const volPct5m = ewmaSigma * Math.sqrt(5) * 100;

    const feature = featureVectorSchema.parse({
      symbol,
      timeframe,
      closeTime,
      logReturn: latestReturn,
      atrPct,
      ewmaSigma,
      sigmaNorm,
      volPct5m,
      bbWidthPct,
      bbWidthPercentile,
      ema20,
      ema50,
      ema200,
      ema50Slope,
      volumePct,
      volumePercentile
    });

    const created = await this.prisma.feature.upsert({
      where: {
        symbol_timeframe_computedAt: {
          symbol,
          timeframe,
          computedAt: new Date(closeTime)
        }
      },
      create: {
        symbol,
        timeframe,
        computedAt: new Date(closeTime),
        payload: feature,
        paramVersion: 'baseline'
      },
      update: {
        payload: feature
      }
    });

    this.eventBus.emit('features.ready', feature);

    await this.prisma.auditEvent.create({
      data: {
        category: 'feature_pipeline',
        action: 'features_computed',
        actor: 'feature_service',
        metadata: {
          symbol,
          timeframe,
          closeTime,
          featureHash: hashObject(feature),
          featureId: String(created.id)
        }
      }
    });
  }
}

function buildSigmaSeries(returns: number[], lambda: number): number[] {
  const sigmas: number[] = [];

  for (let index = 5; index <= returns.length; index += 1) {
    sigmas.push(computeEwmaSigma(returns.slice(0, index), lambda));
  }

  return sigmas;
}

function buildBbWidthSeries(closes: number[], period: number): number[] {
  const widths: number[] = [];

  for (let index = period; index <= closes.length; index += 1) {
    widths.push(computeBollingerWidthPct(closes.slice(0, index), period));
  }

  return widths;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }

  return sorted[mid] ?? 0;
}

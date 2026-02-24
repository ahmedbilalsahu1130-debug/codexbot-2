import type { PrismaClient } from '@prisma/client';

import type { Candle } from '../domain/models.js';
import { assertClosedCandle, candleSchema, hashObject } from '../domain/models.js';
import type { EventBus } from '../events/eventBus.js';
import type { MexcClient } from '../mexc/client.js';

type Timeframe = '1m' | '5m';

type MarketDataServiceOptions = {
  prisma: PrismaClient;
  mexcClient: MexcClient;
  eventBus: EventBus;
  candlesPath?: string;
};

type RawKline = [number, string, string, string, string, string, number] | Record<string, unknown>;

const DEFAULT_CANDLES_PATH = '/api/v3/klines';

export class MarketDataService {
  private readonly prisma: PrismaClient;
  private readonly mexcClient: MexcClient;
  private readonly eventBus: EventBus;
  private readonly candlesPath: string;

  constructor(options: MarketDataServiceOptions) {
    this.prisma = options.prisma;
    this.mexcClient = options.mexcClient;
    this.eventBus = options.eventBus;
    this.candlesPath = options.candlesPath ?? DEFAULT_CANDLES_PATH;
  }

  async poll(symbols: string[], timeframe: Timeframe, lookback: number): Promise<void> {
    for (const symbol of symbols) {
      const raw = await this.mexcClient.publicGet<RawKline[]>(this.candlesPath, {
        symbol,
        interval: timeframe,
        limit: lookback
      });

      const normalized = raw.map((item) => this.normalizeRawCandle(symbol, timeframe, item));
      const integrityError = this.checkIntegrity(normalized, timeframe);

      if (integrityError) {
        await this.recordIntegrityFailure(symbol, timeframe, integrityError, normalized);
        continue;
      }

      for (let index = 0; index < normalized.length; index += 1) {
        const candle = normalized[index];
        if (!candle) {
          continue;
        }

        let isClosed = true;
        try {
          assertClosedCandle(candle);
        } catch {
          isClosed = false;
        }

        const existing = await this.prisma.candle.findUnique({
          where: {
            symbol_timeframe_closeTime: {
              symbol: candle.symbol,
              timeframe: candle.timeframe,
              closeTime: new Date(candle.closeTime)
            }
          }
        });

        if (existing) {
          continue;
        }

        await this.prisma.candle.create({
          data: {
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            openTime: new Date(candle.closeTime - timeframeToMs(timeframe)),
            closeTime: new Date(candle.closeTime),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            rawPayload: raw[index] ? (raw[index] as unknown as object) : undefined
          }
        });

        if (isClosed) {
          this.eventBus.emit('candle.closed', candle);
        }
      }
    }
  }

  normalizeRawCandle(symbol: string, timeframe: Timeframe, raw: RawKline): Candle {
    if (Array.isArray(raw)) {
      const closeTime = Number(raw[6]);
      return candleSchema.parse({
        symbol,
        timeframe,
        closeTime,
        open: Number(raw[1]),
        high: Number(raw[2]),
        low: Number(raw[3]),
        close: Number(raw[4]),
        volume: Number(raw[5])
      });
    }

    return candleSchema.parse({
      symbol,
      timeframe,
      closeTime: Number(raw.closeTime),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume)
    });
  }

  private checkIntegrity(candles: Candle[], timeframe: Timeframe): string | null {
    const seen = new Set<number>();
    const intervalMs = timeframeToMs(timeframe);

    for (let index = 0; index < candles.length; index += 1) {
      const current = candles[index];
      if (!current) {
        continue;
      }

      if (seen.has(current.closeTime)) {
        return `Duplicate closeTime detected: ${current.closeTime}`;
      }
      seen.add(current.closeTime);

      if (index > 0) {
        const previous = candles[index - 1];
        if (!previous) {
          continue;
        }

        if (current.closeTime < previous.closeTime) {
          return `Out-of-order closeTime detected: ${previous.closeTime} -> ${current.closeTime}`;
        }

        const delta = current.closeTime - previous.closeTime;
        if (delta > intervalMs) {
          return `Gap detected between candles: ${previous.closeTime} -> ${current.closeTime}`;
        }
      }
    }

    return null;
  }

  private async recordIntegrityFailure(
    symbol: string,
    timeframe: Timeframe,
    reason: string,
    candles: Candle[]
  ): Promise<void> {
    const now = Date.now();

    await this.prisma.auditEvent.create({
      data: {
        category: 'market_data_integrity',
        action: 'poll_failed',
        actor: 'market_data_service',
        metadata: {
          symbol,
          timeframe,
          reason,
          candles
        }
      }
    });

    this.eventBus.emit('audit.event', {
      id: `audit-${now}-${Math.random().toString(16).slice(2, 10)}`,
      ts: now,
      step: 'marketData.integrity',
      level: 'error',
      message: reason,
      inputsHash: hashObject({ symbol, timeframe, candles }),
      outputsHash: hashObject({ reason }),
      paramsVersionId: 'system',
      metadata: {
        symbol,
        timeframe,
        reason
      }
    });
  }
}

function timeframeToMs(timeframe: Timeframe): number {
  if (timeframe === '1m') {
    return 60_000;
  }

  return 300_000;
}

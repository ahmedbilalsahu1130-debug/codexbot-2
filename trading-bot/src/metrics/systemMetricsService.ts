import type { PrismaClient } from '@prisma/client';

import type { EventBus } from '../events/eventBus.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class SystemMetricsService {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly lastCandleBySymbol = new Map<string, number>();
  private readonly defensiveStartedAtBySymbol = new Map<string, number>();

  constructor(options: { prisma: PrismaClient; eventBus: EventBus }) {
    this.prisma = options.prisma;
    this.eventBus = options.eventBus;
  }

  subscribe(): void {
    this.eventBus.on('candle.closed', async (candle) => {
      this.lastCandleBySymbol.set(candle.symbol, candle.closeTime);
    });

    this.eventBus.on('signal.generated', async (payload) => {
      await this.bumpMetric(payload.feature.closeTime, payload.regime.regime, 'signals', 1);
    });

    this.eventBus.on('risk.rejected', async (payload) => {
      await this.bumpMetric(Date.now(), 'ALL', 'blockedByRisk', 1);

      if (payload.reason.toLowerCase().includes('cooldown')) {
        await this.bumpMetric(Date.now(), 'ALL', 'cooldownActivations', 1);
      }
    });

    this.eventBus.on('order.filled', async (fill) => {
      const order = await this.prisma.order.findFirst({
        where: { id: BigInt(fill.orderId) },
        select: { orderType: true, price: true }
      });

      const orderType = order?.orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
      if (orderType === 'MARKET') {
        await this.bumpMetric(fill.ts, 'ALL', 'fillsMarket', 1);
      } else {
        await this.bumpMetric(fill.ts, 'ALL', 'fillsLimit', 1);
      }

      const refPrice = Number(order?.price ?? fill.price);
      const slippageBps = refPrice > 0 ? (Math.abs(fill.price - refPrice) / refPrice) * 10_000 : 0;
      await this.bumpSlippage(fill.ts, 'ALL', slippageBps);
    });

    this.eventBus.on('regime.updated', async (decision) => {
      const key = decision.symbol;
      const ts = decision.closeTime5m;

      if (decision.defensive && !this.defensiveStartedAtBySymbol.has(key)) {
        this.defensiveStartedAtBySymbol.set(key, ts);
        return;
      }

      if (!decision.defensive && this.defensiveStartedAtBySymbol.has(key)) {
        const started = this.defensiveStartedAtBySymbol.get(key) ?? ts;
        this.defensiveStartedAtBySymbol.delete(key);

        await this.bumpMetric(ts, 'ALL', 'defensiveDurationMs', Math.max(0, ts - started));
      }
    });
  }

  async getDailyMetrics(dayMs = Date.now()): Promise<{
    date: number;
    signalsPerRegime: Record<string, number>;
    fillRatio: { limit: number; market: number };
    averageSlippageBps: number;
    tradesBlockedByRisk: number;
    cooldownActivationCount: number;
    defensiveModeDurationMs: number;
  }> {
    const dayStart = this.dayStart(dayMs);
    const rows = await this.prisma.systemMetricDaily.findMany({ where: { date: new Date(dayStart) } });

    const signalsPerRegime: Record<string, number> = {};
    let fillsLimit = 0;
    let fillsMarket = 0;
    let slippageSumBps = 0;
    let slippageSamples = 0;
    let tradesBlockedByRisk = 0;
    let cooldownActivationCount = 0;
    let defensiveModeDurationMs = 0;

    for (const row of rows) {
      signalsPerRegime[row.regime] = Number(row.signals);
      fillsLimit += Number(row.fillsLimit);
      fillsMarket += Number(row.fillsMarket);
      slippageSumBps += Number(row.slippageSumBps);
      slippageSamples += Number(row.slippageSamples);
      tradesBlockedByRisk += Number(row.blockedByRisk);
      cooldownActivationCount += Number(row.cooldownActivations);
      defensiveModeDurationMs += Number(row.defensiveDurationMs);
    }

    return {
      date: dayStart,
      signalsPerRegime,
      fillRatio: { limit: fillsLimit, market: fillsMarket },
      averageSlippageBps: slippageSamples > 0 ? slippageSumBps / slippageSamples : 0,
      tradesBlockedByRisk,
      cooldownActivationCount,
      defensiveModeDurationMs
    };
  }

  async getHealth(): Promise<{
    db: 'ok' | 'error';
    eventBusLag: number;
    lastCandleTimePerSymbol: Record<string, number>;
  }> {
    let db: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }

    return {
      db,
      eventBusLag: this.eventBus.getPendingCount(),
      lastCandleTimePerSymbol: Object.fromEntries(this.lastCandleBySymbol.entries())
    };
  }

  private async bumpMetric(
    dayMs: number,
    regime: string,
    field: 'signals' | 'fillsLimit' | 'fillsMarket' | 'blockedByRisk' | 'cooldownActivations' | 'defensiveDurationMs',
    by: number
  ): Promise<void> {
    const date = new Date(this.dayStart(dayMs));
    const existing = await this.prisma.systemMetricDaily.findUnique({
      where: { date_regime: { date, regime } }
    });

    if (!existing) {
      await this.prisma.systemMetricDaily.create({
        data: {
          date,
          regime,
          signals: field === 'signals' ? by : 0,
          fillsLimit: field === 'fillsLimit' ? by : 0,
          fillsMarket: field === 'fillsMarket' ? by : 0,
          slippageSumBps: 0,
          slippageSamples: 0,
          blockedByRisk: field === 'blockedByRisk' ? by : 0,
          cooldownActivations: field === 'cooldownActivations' ? by : 0,
          defensiveDurationMs: field === 'defensiveDurationMs' ? by : 0
        }
      });
      return;
    }

    await this.prisma.systemMetricDaily.update({
      where: { id: existing.id },
      data: { [field]: Number((existing as Record<string, unknown>)[field] ?? 0) + by }
    });
  }

  private async bumpSlippage(dayMs: number, regime: string, slippageBps: number): Promise<void> {
    const date = new Date(this.dayStart(dayMs));
    const existing = await this.prisma.systemMetricDaily.findUnique({ where: { date_regime: { date, regime } } });

    if (!existing) {
      await this.prisma.systemMetricDaily.create({
        data: {
          date,
          regime,
          signals: 0,
          fillsLimit: 0,
          fillsMarket: 0,
          slippageSumBps: slippageBps,
          slippageSamples: 1,
          blockedByRisk: 0,
          cooldownActivations: 0,
          defensiveDurationMs: 0
        }
      });
      return;
    }

    await this.prisma.systemMetricDaily.update({
      where: { id: existing.id },
      data: {
        slippageSumBps: Number(existing.slippageSumBps) + slippageBps,
        slippageSamples: Number(existing.slippageSamples) + 1
      }
    });
  }

  private dayStart(ts: number): number {
    return Math.floor(ts / DAY_MS) * DAY_MS;
  }
}

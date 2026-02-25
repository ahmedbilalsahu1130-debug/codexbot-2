import type { PrismaClient } from '@prisma/client';

export type ActiveParams = {
  paramsVersionId: string;
  effectiveFrom: number;
  kb: number;
  ks: number;
  leverageBands: Record<string, unknown>;
  cooldownRules: Record<string, unknown>;
  portfolioCaps: Record<string, unknown>;
};

export type ParamsServiceOptions = {
  prisma: PrismaClient;
  refreshIntervalMs?: number;
};

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

export class ParamsService {
  private readonly prisma: PrismaClient;
  private readonly refreshIntervalMs: number;
  private cache: ActiveParams | null = null;
  private cacheLoadedAt = 0;

  constructor(options: ParamsServiceOptions) {
    this.prisma = options.prisma;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  }

  async getActiveParams(atMs = Date.now()): Promise<ActiveParams> {
    if (this.cache && Date.now() - this.cacheLoadedAt < this.refreshIntervalMs) {
      return this.cache;
    }

    const row = await this.prisma.paramVersion.findFirst({
      where: { effectiveFrom: { lte: new Date(atMs) } },
      orderBy: { effectiveFrom: 'desc' }
    });

    if (!row) {
      throw new Error('No active param version found');
    }

    const active: ActiveParams = {
      paramsVersionId: String(row.id),
      effectiveFrom: row.effectiveFrom.getTime(),
      kb: Number(row.kb),
      ks: Number(row.ks),
      leverageBands: ensureObject(row.leverageBandsJson),
      cooldownRules: ensureObject(row.cooldownRulesJson),
      portfolioCaps: ensureObject(row.portfolioCapsJson)
    };

    this.cache = active;
    this.cacheLoadedAt = Date.now();
    return active;
  }

  clearCache(): void {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

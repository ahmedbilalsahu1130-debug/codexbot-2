import type { PrismaClient } from '@prisma/client';

export type PortfolioCaps = {
  maxOpenPositions: number;
  maxOpenPositionsDefensive: number;
};

export type OpenPositionSnapshot = {
  symbol: string;
  side: 'Long' | 'Short';
  qty: number;
};

export type PortfolioServiceOptions = {
  prisma: PrismaClient;
  caps?: Partial<PortfolioCaps>;
};

const DEFAULT_CAPS: PortfolioCaps = {
  maxOpenPositions: 5,
  maxOpenPositionsDefensive: 2
};

export class PortfolioService {
  private readonly prisma: PrismaClient;
  private readonly caps: PortfolioCaps;

  constructor(options: PortfolioServiceOptions) {
    this.prisma = options.prisma;
    this.caps = { ...DEFAULT_CAPS, ...options.caps };
  }

  async getOpenPositions(): Promise<OpenPositionSnapshot[]> {
    const rows = await this.prisma.position.findMany({
      where: { state: { in: ['OPEN', 'CLOSING'] } },
      orderBy: { openedAt: 'asc' }
    });

    return rows.map((row) => ({
      symbol: row.symbol,
      side: row.side as 'Long' | 'Short',
      qty: Number(row.quantity)
    }));
  }

  async countOpenBySymbol(symbol: string): Promise<number> {
    return this.prisma.position.count({
      where: {
        symbol,
        state: { in: ['OPEN', 'CLOSING'] }
      }
    });
  }

  async countOpenTotal(): Promise<number> {
    return this.prisma.position.count({
      where: {
        state: { in: ['OPEN', 'CLOSING'] }
      }
    });
  }

  getMaxOpenPositions(defensive: boolean): number {
    return defensive ? this.caps.maxOpenPositionsDefensive : this.caps.maxOpenPositions;
  }
}

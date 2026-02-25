import type { Candle } from '../domain/models.js';

import type { ExchangeOrder, IExchangeExecution, PlaceOrderInput } from './exchangeAdapter.js';

export type PaperAdapterOptions = {
  feeRateBps?: number;
};

export class PaperAdapter implements IExchangeExecution {
  private readonly orders = new Map<string, ExchangeOrder>();
  private readonly pendingCandles = new Map<string, Candle[]>();
  private sequence = 0;

  constructor(_options?: PaperAdapterOptions) {}

  seedNextCandles(symbol: string, candles: Candle[]): void {
    this.pendingCandles.set(symbol, candles);
  }

  async placeLimit(input: PlaceOrderInput): Promise<ExchangeOrder> {
    const order = this.buildOrder('LIMIT', input);
    const simulated = this.tryFillWithNextCandles(order);
    this.orders.set(simulated.id, simulated);
    return simulated;
  }

  async placeMarket(input: PlaceOrderInput): Promise<ExchangeOrder> {
    const fillPrice = input.price ?? this.getLastKnownPrice(input.symbol) ?? 0;
    const order = this.buildOrder('MARKET', input);
    const filled: ExchangeOrder = {
      ...order,
      status: 'FILLED',
      filledQty: order.qty,
      avgFillPrice: fillPrice
    };
    this.orders.set(filled.id, filled);
    return filled;
  }

  async cancelOrder(orderId: string): Promise<ExchangeOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Unknown order ${orderId}`);
    }

    const canceled = { ...order, status: 'CANCELED' as const };
    this.orders.set(orderId, canceled);
    return canceled;
  }

  async getOrderStatus(orderId: string): Promise<ExchangeOrder> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Unknown order ${orderId}`);
    }

    return order;
  }

  private buildOrder(type: 'LIMIT' | 'MARKET', input: PlaceOrderInput): ExchangeOrder {
    this.sequence += 1;
    return {
      id: `paper-${this.sequence}`,
      symbol: input.symbol,
      side: input.side,
      type,
      status: 'OPEN',
      qty: input.qty,
      price: input.price,
      filledQty: 0,
      createdAt: Date.now()
    };
  }

  private tryFillWithNextCandles(order: ExchangeOrder): ExchangeOrder {
    if (order.price === undefined) {
      return order;
    }

    const candles = this.pendingCandles.get(order.symbol) ?? [];
    const next = candles.shift();
    this.pendingCandles.set(order.symbol, candles);

    if (!next) {
      return order;
    }

    const crosses = order.side === 'Long' ? next.low <= order.price : next.high >= order.price;
    if (!crosses) {
      return order;
    }

    return {
      ...order,
      status: 'FILLED',
      filledQty: order.qty,
      avgFillPrice: order.price
    };
  }

  private getLastKnownPrice(symbol: string): number | null {
    const candles = this.pendingCandles.get(symbol) ?? [];
    const latest = candles[candles.length - 1];
    return latest ? latest.close : null;
  }
}

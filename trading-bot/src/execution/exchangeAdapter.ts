export type ExecutionSide = 'Long' | 'Short';
export type ExecutionOrderType = 'LIMIT' | 'MARKET';
export type ExecutionOrderStatus = 'OPEN' | 'FILLED' | 'CANCELED' | 'REJECTED';

export type PlaceOrderInput = {
  symbol: string;
  side: ExecutionSide;
  qty: number;
  price?: number;
  clientOrderId?: string;
};

export type ExchangeOrder = {
  id: string;
  symbol: string;
  side: ExecutionSide;
  type: ExecutionOrderType;
  status: ExecutionOrderStatus;
  qty: number;
  price?: number;
  filledQty: number;
  avgFillPrice?: number;
  createdAt: number;
};

export interface IExchangeExecution {
  placeLimit(input: PlaceOrderInput): Promise<ExchangeOrder>;
  placeMarket(input: PlaceOrderInput): Promise<ExchangeOrder>;
  cancelOrder(orderId: string): Promise<ExchangeOrder>;
  getOrderStatus(orderId: string): Promise<ExchangeOrder>;
}

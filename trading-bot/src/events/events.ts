import type {
  AuditEvent,
  Candle,
  FeatureVector,
  Fill,
  Order,
  Position,
  RegimeDecision,
  TradePlan
} from '../domain/models.js';

export type SignalGeneratedPayload = {
  tradePlan: TradePlan;
  feature: FeatureVector;
  regime: RegimeDecision;
};

export type RiskApprovedPayload = {
  plan: TradePlan;
  signal: SignalGeneratedPayload;
  qty: number;
  finalLeverage: number;
  regime: RegimeDecision;
};

export type RiskRejectedPayload = {
  plan: TradePlan;
  signal: SignalGeneratedPayload;
  reason: string;
  regime: RegimeDecision;
};

export type OrderCanceledPayload = {
  orderId: string;
  reason: string;
};

export type PositionClosedPayload = {
  positionId: string;
  reason: string;
  realizedR: number;
};

export type TradingEventMap = {
  'candle.closed': Candle;
  'features.ready': FeatureVector;
  'regime.updated': RegimeDecision;
  'signal.generated': SignalGeneratedPayload;
  'risk.approved': RiskApprovedPayload;
  'risk.rejected': RiskRejectedPayload;
  'order.submitted': Order;
  'order.filled': Fill;
  'order.canceled': OrderCanceledPayload;
  'position.updated': Position;
  'position.closed': PositionClosedPayload;
  'audit.event': AuditEvent;
};

export type TradingEventName = keyof TradingEventMap;
export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

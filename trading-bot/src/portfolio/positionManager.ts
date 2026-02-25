import type { PrismaClient } from '@prisma/client';

import type { RegimeDecision } from '../domain/models.js';
import type { AuditService } from '../audit/auditService.js';
import { hashObject } from '../domain/models.js';
import type { EventBus } from '../events/eventBus.js';
import { computeAtrPct } from '../indicators/atr.js';

import type { PositionLifecycleState } from './stateMachine.js';
import { nextState } from './stateMachine.js';

export type ManagedPosition = {
  id: string;
  symbol: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  initialStopPrice: number;
  stopPrice: number;
  qty: number;
  remainingQty: number;
  state: PositionLifecycleState;
  realizedR: number;
  took1R: boolean;
  took2R: boolean;
  trailingAnchor: number;
  atrPct: number;
  paramsVersionId: string;
};

export type PositionManagerConfig = {
  trailingAtrMultiple: number;
  hardExitOnRange: boolean;
  hardExitOnExpansionChaos: boolean;
  reduceRiskOnRangePct: number;
};

export type PositionManagerOptions = {
  prisma: PrismaClient;
  eventBus: EventBus;
  config?: Partial<PositionManagerConfig>;
  auditService?: AuditService;
  getActiveParamsVersionId?: () => Promise<string>;
};

const DEFAULT_CONFIG: PositionManagerConfig = {
  trailingAtrMultiple: 1,
  hardExitOnRange: false,
  hardExitOnExpansionChaos: true,
  reduceRiskOnRangePct: 50
};

export class PositionManager {
  private readonly prisma: PrismaClient;
  private readonly eventBus: EventBus;
  private readonly config: PositionManagerConfig;
  private readonly auditService?: AuditService;
  private readonly getActiveParamsVersionId?: () => Promise<string>;
  private readonly managed = new Map<string, ManagedPosition>();

  constructor(options: PositionManagerOptions) {
    this.prisma = options.prisma;
    this.eventBus = options.eventBus;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.auditService = options.auditService;
    this.getActiveParamsVersionId = options.getActiveParamsVersionId;
  }

  arm(position: Omit<ManagedPosition, 'state' | 'realizedR' | 'took1R' | 'took2R' | 'trailingAnchor'>): ManagedPosition {
    const managed: ManagedPosition = {
      ...position,
      state: 'ARMED',
      realizedR: 0,
      took1R: false,
      took2R: false,
      trailingAnchor: position.entryPrice
    };

    this.managed.set(position.id, managed);
    return managed;
  }


  async onOrderSubmitted(input: {
    positionId: string;
    symbol: string;
    side: 'Long' | 'Short';
    entryPrice: number;
    qty: number;
    atrPct: number;
    paramsVersionId: string;
  }): Promise<void> {
    const initialStopPrice = buildInitialStop(input.entryPrice, input.atrPct, input.side);
    this.arm({
      id: input.positionId,
      symbol: input.symbol,
      side: input.side,
      entryPrice: input.entryPrice,
      initialStopPrice,
      stopPrice: initialStopPrice,
      qty: input.qty,
      remainingQty: input.qty,
      atrPct: input.atrPct,
      paramsVersionId: input.paramsVersionId
    });

    const pos = this.managed.get(input.positionId);
    if (!pos) return;
    pos.state = nextState(pos.state, 'ORDER_SUBMITTED');
    await this.emitUpdate(pos, 'order submitted');
  }

  async onOrderFilledEvent(positionId: string): Promise<void> {
    await this.onOrderFilled(positionId);
  }

  async onOrderCanceled(positionId: string): Promise<void> {
    const pos = this.managed.get(positionId);
    if (!pos) return;
    pos.state = 'NEUTRAL';
    await this.emitUpdate(pos, 'order canceled');
  }

  async onOrderFilled(positionId: string): Promise<void> {
    const pos = this.managed.get(positionId);
    if (!pos) return;
    pos.state = nextState(pos.state, 'ORDER_FILLED');
    await this.emitUpdate(pos, 'order filled');
  }

  async onPrice(positionId: string, price: number, candleHigh?: number, candleLow?: number): Promise<void> {
    const pos = this.managed.get(positionId);
    if (!pos || pos.state !== 'IN_POSITION') {
      return;
    }

    await this.warnOnParamDrift(pos);

    const riskPerUnit = Math.max(1e-8, Math.abs(pos.entryPrice - pos.initialStopPrice));
    const pnlPerUnit = pos.side === 'Long' ? price - pos.entryPrice : pos.entryPrice - price;
    const rMultiple = pnlPerUnit / riskPerUnit;

    if (!pos.took1R && rMultiple >= 1) {
      await this.partialExit(pos, 0.5, price, '+1R partial');
      pos.took1R = true;
    }

    if (!pos.took2R && rMultiple >= 2) {
      await this.partialExit(pos, 0.3, price, '+2R partial');
      pos.took2R = true;
    }

    if (pos.took2R) {
      this.updateTrailingStop(pos, price, candleHigh, candleLow);
    }

    if (
      (pos.side === 'Long' && price <= pos.stopPrice) ||
      (pos.side === 'Short' && price >= pos.stopPrice)
    ) {
      await this.closePosition(pos, price, 'stop hit');
      return;
    }

    await this.emitUpdate(pos, 'price update');
  }

  async onRegimeChange(positionId: string, regime: RegimeDecision, currentPrice: number): Promise<void> {
    const pos = this.managed.get(positionId);
    if (!pos || pos.state !== 'IN_POSITION') {
      return;
    }

    await this.warnOnParamDrift(pos);

    if (regime.regime === 'ExpansionChaos' && this.config.hardExitOnExpansionChaos) {
      await this.closePosition(pos, currentPrice, 'hard exit on ExpansionChaos');
      return;
    }

    if (regime.regime === 'Range' && this.config.hardExitOnRange) {
      await this.closePosition(pos, currentPrice, 'hard exit on Range');
      return;
    }

    if (regime.regime === 'Range' && !this.config.hardExitOnRange) {
      await this.partialExit(pos, this.config.reduceRiskOnRangePct / 100, currentPrice, 'risk reduction on Range');
      await this.emitUpdate(pos, 'risk reduced on regime change');
    }
  }

  private updateTrailingStop(pos: ManagedPosition, price: number, candleHigh?: number, candleLow?: number): void {
    const anchor = pos.side === 'Long' ? (candleHigh ?? price) : (candleLow ?? price);
    pos.trailingAnchor = pos.side === 'Long' ? Math.max(pos.trailingAnchor, anchor) : Math.min(pos.trailingAnchor, anchor);

    const trailingDistance = (pos.atrPct / 100) * pos.entryPrice * this.config.trailingAtrMultiple;
    const candidate = pos.side === 'Long' ? pos.trailingAnchor - trailingDistance : pos.trailingAnchor + trailingDistance;

    pos.stopPrice = pos.side === 'Long' ? Math.max(pos.stopPrice, candidate) : Math.min(pos.stopPrice, candidate);
  }

  private async partialExit(pos: ManagedPosition, fraction: number, fillPrice: number, reason: string): Promise<void> {
    const qtyToExit = Math.min(pos.remainingQty, pos.qty * fraction);
    if (qtyToExit <= 0) return;

    pos.remainingQty -= qtyToExit;

    await this.warnOnParamDrift(pos);

    const riskPerUnit = Math.max(1e-8, Math.abs(pos.entryPrice - pos.initialStopPrice));
    const pnlPerUnit = pos.side === 'Long' ? fillPrice - pos.entryPrice : pos.entryPrice - fillPrice;
    pos.realizedR += (pnlPerUnit / riskPerUnit) * (qtyToExit / pos.qty);

    await this.prisma.auditEvent.create({
      data: {
        step: 'position.partialExit',
        level: 'info',
        message: 'partial exit',
        reason,
        inputsHash: hashObject({ positionId: pos.id, qtyToExit, fillPrice }),
        outputsHash: hashObject({ remainingQty: pos.remainingQty, realizedR: pos.realizedR }),
        paramsVersionId: pos.paramsVersionId,
        metadata: { positionId: pos.id, qtyToExit, fillPrice, reason }
      }
    });

    if (pos.remainingQty <= 1e-10) {
      await this.closePosition(pos, fillPrice, 'all partial exits completed');
    }
  }

  private async closePosition(pos: ManagedPosition, fillPrice: number, reason: string): Promise<void> {
    const qtyToExit = pos.remainingQty;
    pos.remainingQty = 0;
    pos.state = nextState('IN_POSITION', 'POSITION_CLOSED');

    await this.prisma.auditEvent.create({
      data: {
        step: 'position.close',
        level: 'warn',
        message: 'position closed',
        reason,
        inputsHash: hashObject({ positionId: pos.id, fillPrice, qtyToExit }),
        outputsHash: hashObject({ realizedR: pos.realizedR }),
        paramsVersionId: pos.paramsVersionId,
        metadata: { positionId: pos.id, fillPrice, qtyToExit, reason }
      }
    });

    this.eventBus.emit('position.closed', {
      positionId: pos.id,
      reason,
      realizedR: pos.realizedR
    });

    this.eventBus.emit('position.updated', {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      qty: pos.qty,
      stopPrice: pos.stopPrice,
      state: pos.state,
      realizedR: pos.realizedR,
      remainingQty: pos.remainingQty,
      paramsVersionId: pos.paramsVersionId,
      openedAt: Date.now(),
      updatedAt: Date.now()
    });
  }


  private async warnOnParamDrift(pos: ManagedPosition): Promise<void> {
    if (!this.getActiveParamsVersionId || !this.auditService) {
      return;
    }

    const activeParamsVersionId = await this.getActiveParamsVersionId();
    if (activeParamsVersionId === pos.paramsVersionId) {
      return;
    }

    await this.auditService.log({
      step: 'position.paramDrift',
      level: 'warn',
      message: 'params version changed mid-position',
      reason: 'params_drift',
      inputs: {
        positionId: pos.id,
        symbol: pos.symbol,
        activeParamsVersionId,
        positionParamsVersionId: pos.paramsVersionId
      },
      outputs: { status: 'warning' },
      paramsVersionId: pos.paramsVersionId,
      metadata: { positionId: pos.id, symbol: pos.symbol }
    });
  }

  private async emitUpdate(pos: ManagedPosition, message: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        step: 'position.update',
        level: 'info',
        message,
        inputsHash: hashObject({ positionId: pos.id }),
        outputsHash: hashObject({ stopPrice: pos.stopPrice, remainingQty: pos.remainingQty }),
        paramsVersionId: pos.paramsVersionId,
        metadata: { positionId: pos.id, message, stopPrice: pos.stopPrice, remainingQty: pos.remainingQty }
      }
    });

    this.eventBus.emit('position.updated', {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      qty: pos.qty,
      stopPrice: pos.stopPrice,
      state: pos.state,
      realizedR: pos.realizedR,
      remainingQty: pos.remainingQty,
      paramsVersionId: pos.paramsVersionId,
      openedAt: Date.now(),
      updatedAt: Date.now()
    });
  }
}

export function buildInitialStop(entryPrice: number, atrPct: number, side: 'Long' | 'Short', k = 1): number {
  const stopDistance = (atrPct / 100) * entryPrice * k;
  return side === 'Long' ? entryPrice - stopDistance : entryPrice + stopDistance;
}

export function atrPctFromRange(high: number, low: number, close: number): number {
  return computeAtrPct(Math.abs(high - low), close);
}

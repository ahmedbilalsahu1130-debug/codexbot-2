import { EventEmitter } from 'node:events';

import type { AuditEvent } from '../domain/models.js';
import { hashObject } from '../domain/models.js';

import type { EventHandler, TradingEventMap, TradingEventName } from './events.js';

export type EventBusOptions = {
  queueEmits?: boolean;
};

type QueuedEvent<TName extends TradingEventName = TradingEventName> = {
  event: TName;
  payload: TradingEventMap[TName];
};

const DEFAULT_QUEUE_OPTIONS: Required<EventBusOptions> = {
  queueEmits: false
};

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly options: Required<EventBusOptions>;
  private readonly queue: QueuedEvent[] = [];
  private isFlushingQueue = false;

  constructor(options?: EventBusOptions) {
    this.options = {
      ...DEFAULT_QUEUE_OPTIONS,
      ...options
    };
  }

  on<TName extends TradingEventName>(event: TName, handler: EventHandler<TradingEventMap[TName]>): () => void {
    const wrapped = async (payload: TradingEventMap[TName]) => {
      try {
        await handler(payload);
      } catch (error: unknown) {
        this.emitAuditFromError(event, payload, error);
      }
    };

    this.emitter.on(event, wrapped as (payload: TradingEventMap[TName]) => void);

    return () => {
      this.emitter.off(event, wrapped as (payload: TradingEventMap[TName]) => void);
    };
  }

  emit<TName extends TradingEventName>(event: TName, payload: TradingEventMap[TName]): void {
    if (!this.options.queueEmits) {
      this.emitter.emit(event, payload);
      return;
    }

    this.queue.push({ event, payload });
    this.flushQueue();
  }


  getPendingCount(): number {
    return this.queue.length;
  }
  private flushQueue(): void {
    if (this.isFlushingQueue) {
      return;
    }

    this.isFlushingQueue = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) {
          continue;
        }

        this.emitter.emit(item.event, item.payload);
      }
    } finally {
      this.isFlushingQueue = false;
    }
  }

  private emitAuditFromError<TName extends TradingEventName>(
    sourceEvent: TName,
    sourcePayload: TradingEventMap[TName],
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : 'Unknown handler error';

    const audit: AuditEvent = {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      ts: Date.now(),
      step: `events.handler.${sourceEvent}`,
      level: 'error',
      message,
      inputsHash: hashObject(sourcePayload),
      outputsHash: hashObject({ sourceEvent, message }),
      paramsVersionId: 'system',
      metadata: {
        sourceEvent,
        errorName: error instanceof Error ? error.name : 'UnknownError'
      }
    };

    this.emitter.emit('audit.event', audit);
  }
}

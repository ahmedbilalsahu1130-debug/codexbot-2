import { EventBus } from '../src/events/eventBus.js';

describe('EventBus', () => {
  it('subscribes and emits strongly-typed events', () => {
    const bus = new EventBus();
    const seen: string[] = [];

    const unsubscribe = bus.on('candle.closed', (payload) => {
      seen.push(`${payload.symbol}:${payload.timeframe}`);
    });

    bus.emit('candle.closed', {
      symbol: 'BTCUSDT',
      timeframe: '5m',
      closeTime: Date.now() - 10_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000
    });

    unsubscribe();

    expect(seen).toEqual(['BTCUSDT:5m']);
  });

  it('emits audit.event when a handler throws', async () => {
    const bus = new EventBus();
    const received: Array<{ step: string; level: string; message: string }> = [];

    const done = new Promise<void>((resolve) => {
      bus.on('audit.event', (audit) => {
        received.push({ step: audit.step, level: audit.level, message: audit.message });
        resolve();
      });
    });

    bus.on('features.ready', () => {
      throw new Error('feature handler exploded');
    });

    bus.emit('features.ready', {
      symbol: 'BTCUSDT',
      timeframe: '5m',
      closeTime: Date.now() - 10_000,
      atrPct: 0.1,
      ewmaSigma: 0.2,
      sigmaNorm: 0.3,
      volPct5m: 0.4,
      bbWidthPct: 0.5,
      ema20: 100,
      ema50: 101,
      ema200: 102,
      ema50Slope: 0.01,
      volumePct: 1.2
    });

    await done;

    expect(received).toHaveLength(1);
    expect(received[0]?.level).toBe('error');
    expect(received[0]?.step).toBe('events.handler.features.ready');
    expect(received[0]?.message).toContain('exploded');
  });

  it('supports queued emits to avoid re-entrancy loops', () => {
    const bus = new EventBus({ queueEmits: true });
    const events: string[] = [];

    bus.on('order.submitted', (order) => {
      events.push(`submitted:${order.id}`);
      bus.emit('order.canceled', { orderId: order.id, reason: 'test-cancel' });
    });

    bus.on('order.canceled', (payload) => {
      events.push(`canceled:${payload.orderId}`);
    });

    bus.emit('order.submitted', {
      id: 'ord_123',
      symbol: 'BTCUSDT',
      status: 'OPEN',
      type: 'LIMIT',
      side: 'Long',
      price: 100,
      qty: 1,
      createdAt: Date.now()
    });

    expect(events).toEqual(['submitted:ord_123', 'canceled:ord_123']);
  });
});

/**
 * Compile-time contract examples (TypeScript-only):
 *
 * const bus = new EventBus();
 *
 * // @ts-expect-error `qty` must be number.
 * bus.emit('order.submitted', { qty: '1' });
 *
 * // @ts-expect-error unknown event name.
 * bus.on('unknown.event', () => {});
 */

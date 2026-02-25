import { EventBus } from '../src/events/eventBus.js';
import { StrategyPlanner } from '../src/strategy/strategyPlanner.js';

function feature(timeframe: '1m' | '5m', overrides: Partial<Record<string, number | string>> = {}) {
  return {
    symbol: 'BTCUSDT',
    timeframe,
    closeTime: Number(overrides.closeTime ?? Date.now()),
    logReturn: 0.001,
    atrPct: 0.5,
    ewmaSigma: 0.2,
    sigmaNorm: 1,
    volPct5m: 1,
    bbWidthPct: 0.8,
    bbWidthPercentile: Number(overrides.bbWidthPercentile ?? 20),
    ema20: 100,
    ema50: 101,
    ema200: 99,
    ema50Slope: 0.01,
    volumePct: 100,
    volumePercentile: 80
  };
}

function regime(kind: 'Compression' | 'Trend' | 'Range' | 'ExpansionChaos', defensive = false, closeTime5m?: number) {
  return {
    symbol: 'BTCUSDT',
    closeTime5m: closeTime5m ?? Date.now(),
    regime: kind,
    engine: kind === 'Compression' ? 'Breakout' : kind === 'Trend' ? 'Continuation' : kind === 'Range' ? 'Reversal' : 'Defensive',
    defensive
  } as const;
}

describe('StrategyPlanner', () => {
  it('selects the correct engine for each regime', async () => {
    const bus = new EventBus();
    const emitted: string[] = [];
    bus.on('signal.generated', (payload) => emitted.push(payload.tradePlan.engine));

    const planner = new StrategyPlanner({
      eventBus: bus,
      breakoutEngine: { evaluate: jest.fn(async () => ({ triggered: true, reason: 'ok', plan: { symbol: 'BTCUSDT', side: 'Long', engine: 'Breakout', entryPrice: 100, stopPct: 1, tpModel: 'A', leverage: 2, marginPct: 3, paramsVersionId: '1', expiresAt: Date.now() + 1000, reason: 'b', confidence: 0.5 } })) } as never,
      continuationEngine: { evaluate: jest.fn(async () => ({ triggered: true, reason: 'ok', plan: { symbol: 'BTCUSDT', side: 'Long', engine: 'Continuation', entryPrice: 100, stopPct: 1, tpModel: 'B', leverage: 2, marginPct: 3, paramsVersionId: '1', expiresAt: Date.now() + 1000, reason: 'c', confidence: 0.5 } })) } as never,
      reversalEngine: { evaluate: jest.fn(async () => ({ triggered: true, reason: 'ok', plan: { symbol: 'BTCUSDT', side: 'Short', engine: 'Reversal', entryPrice: 100, stopPct: 1, tpModel: 'B', leverage: 2, marginPct: 3, paramsVersionId: '1', expiresAt: Date.now() + 1000, reason: 'r', confidence: 0.5 } })) } as never,
      paramsService: { getActiveParams: jest.fn(async () => ({ paramsVersionId: '1' })) } as never
    });

    planner.subscribe();

    const t = Date.now();
    bus.emit('regime.updated', regime('Compression', false, t));
    bus.emit('features.ready', feature('1m', { closeTime: t }));

    bus.emit('regime.updated', regime('Trend', false, t + 1));
    bus.emit('features.ready', feature('5m', { closeTime: t + 1 }));

    bus.emit('regime.updated', regime('Range', false, t + 2));
    bus.emit('features.ready', feature('5m', { closeTime: t + 2 }));

    await new Promise((resolve) => setImmediate(resolve));
    expect(emitted).toEqual(['Breakout', 'Continuation', 'Reversal']);
  });

  it('does not fire any engine in defensive mode', async () => {
    const bus = new EventBus();
    const emitted: unknown[] = [];
    const audits: string[] = [];
    bus.on('signal.generated', (p) => emitted.push(p));
    bus.on('audit.event', (a) => audits.push(a.message));

    const breakoutEval = jest.fn();
    const planner = new StrategyPlanner({
      eventBus: bus,
      breakoutEngine: { evaluate: breakoutEval } as never,
      continuationEngine: { evaluate: jest.fn() } as never,
      reversalEngine: { evaluate: jest.fn() } as never,
      paramsService: { getActiveParams: jest.fn(async () => ({ paramsVersionId: '1' })) } as never
    });
    planner.subscribe();

    const t = Date.now();
    bus.emit('regime.updated', regime('Compression', true, t));
    bus.emit('features.ready', feature('1m', { closeTime: t }));

    await new Promise((resolve) => setImmediate(resolve));

    expect(emitted).toHaveLength(0);
    expect(breakoutEval).not.toHaveBeenCalled();
    expect(audits[0]).toBe('defensive_mode');
  });

  it('logs deterministic rejection reason', async () => {
    const bus = new EventBus();
    const reasons: string[] = [];
    bus.on('audit.event', (a) => reasons.push(a.reason ?? a.message));

    const planner = new StrategyPlanner({
      eventBus: bus,
      breakoutEngine: { evaluate: jest.fn(async () => ({ triggered: false, reason: 'compression_gate_failed' })) } as never,
      continuationEngine: { evaluate: jest.fn() } as never,
      reversalEngine: { evaluate: jest.fn() } as never,
      paramsService: { getActiveParams: jest.fn(async () => ({ paramsVersionId: '1' })) } as never
    });
    planner.subscribe();

    const t = Date.now();
    bus.emit('regime.updated', regime('Compression', false, t));
    bus.emit('features.ready', feature('1m', { closeTime: t }));

    await new Promise((resolve) => setImmediate(resolve));
    expect(reasons[0]).toBe('compression_gate_failed');
  });


  it('stamps active paramsVersionId onto generated plans', async () => {
    const bus = new EventBus();
    const paramsService = { getActiveParams: jest.fn(async () => ({ paramsVersionId: '42' })) };
    const plans: Array<{ paramsVersionId: string }> = [];
    bus.on('signal.generated', (payload) => plans.push({ paramsVersionId: payload.tradePlan.paramsVersionId }));

    const planner = new StrategyPlanner({
      eventBus: bus,
      breakoutEngine: { evaluate: jest.fn(async () => ({ triggered: true, reason: 'ok', plan: { symbol: 'BTCUSDT', side: 'Long', engine: 'Breakout', entryPrice: 100, stopPct: 1, tpModel: 'A', leverage: 2, marginPct: 3, paramsVersionId: 'baseline', expiresAt: Date.now() + 1000, reason: 'b', confidence: 0.5 } })) } as never,
      continuationEngine: { evaluate: jest.fn() } as never,
      reversalEngine: { evaluate: jest.fn() } as never,
      paramsService: paramsService as never
    });
    planner.subscribe();

    const t = Date.now();
    bus.emit('regime.updated', regime('Compression', false, t));
    bus.emit('features.ready', feature('1m', { closeTime: t }));

    await new Promise((resolve) => setImmediate(resolve));
    expect(plans[0]?.paramsVersionId).toBe('baseline');
  });

});

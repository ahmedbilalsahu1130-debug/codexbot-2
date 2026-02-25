import { EventBus } from '../src/events/eventBus.js';
import { PositionManager, buildInitialStop } from '../src/portfolio/positionManager.js';

describe('PositionManager', () => {
  it('simulated price path triggers model B partial exits', async () => {
    const events: string[] = [];
    const bus = new EventBus();
    bus.on('position.closed', () => events.push('closed'));

    const prisma = { auditEvent: { create: jest.fn(async () => ({})) } };
    const mgr = new PositionManager({ prisma: prisma as never, eventBus: bus });

    const entry = 100;
    const stop = 99;
    mgr.arm({
      id: 'p1',
      symbol: 'BTCUSDT',
      side: 'Long',
      entryPrice: entry,
      initialStopPrice: stop,
      stopPrice: stop,
      qty: 1,
      remainingQty: 1,
      atrPct: 1,
      paramsVersionId: '1'
    });
    await mgr.onOrderFilled('p1');

    await mgr.onPrice('p1', 101); // +1R => 50%
    await mgr.onPrice('p1', 102); // +2R => +30%
    await mgr.onPrice('p1', 103, 103.5, 102.8); // runner trailing updates
    await mgr.onPrice('p1', 101.5); // should hit trailing eventually maybe not

    // ensure partial audits happened
    const calls = (prisma.auditEvent.create as jest.Mock).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
  });

  it('trailing stop updates correctly after +2R', async () => {
    const bus = new EventBus();
    const updates: number[] = [];
    bus.on('position.updated', (p) => updates.push(p.stopPrice));

    const prisma = { auditEvent: { create: jest.fn(async () => ({})) } };
    const mgr = new PositionManager({
      prisma: prisma as never,
      eventBus: bus,
      config: { trailingAtrMultiple: 1 }
    });

    const entry = 100;
    const stop = 99;
    mgr.arm({
      id: 'p2',
      symbol: 'BTCUSDT',
      side: 'Long',
      entryPrice: entry,
      initialStopPrice: stop,
      stopPrice: stop,
      qty: 1,
      remainingQty: 1,
      atrPct: 1,
      paramsVersionId: '1'
    });
    await mgr.onOrderFilled('p2');

    await mgr.onPrice('p2', 102); // reach +2R
    await mgr.onPrice('p2', 103, 103.5, 103);

    expect(Math.max(...updates)).toBeGreaterThan(99);
  });

  it('hard exit triggers on regime change', async () => {
    const bus = new EventBus();
    let closed = false;
    bus.on('position.closed', () => {
      closed = true;
    });

    const prisma = { auditEvent: { create: jest.fn(async () => ({})) } };
    const mgr = new PositionManager({
      prisma: prisma as never,
      eventBus: bus,
      config: { hardExitOnExpansionChaos: true }
    });

    mgr.arm({
      id: 'p3',
      symbol: 'BTCUSDT',
      side: 'Long',
      entryPrice: 100,
      initialStopPrice: buildInitialStop(100, 1, 'Long'),
      stopPrice: 99,
      qty: 1,
      remainingQty: 1,
      atrPct: 1,
      paramsVersionId: '1'
    });
    await mgr.onOrderFilled('p3');

    await mgr.onRegimeChange(
      'p3',
      {
        symbol: 'BTCUSDT',
        closeTime5m: Date.now(),
        regime: 'ExpansionChaos',
        engine: 'Defensive',
        defensive: true
      },
      100
    );

    expect(closed).toBe(true);
  });


  it('logs warning when params drift mid-position', async () => {
    const bus = new EventBus();
    const prisma = { auditEvent: { create: jest.fn(async () => ({})) } };
    const auditService = { log: jest.fn(async () => undefined) };
    const mgr = new PositionManager({
      prisma: prisma as never,
      eventBus: bus,
      auditService: auditService as never,
      getActiveParamsVersionId: async () => '2'
    });

    mgr.arm({
      id: 'p4',
      symbol: 'BTCUSDT',
      side: 'Long',
      entryPrice: 100,
      initialStopPrice: 99,
      stopPrice: 99,
      qty: 1,
      remainingQty: 1,
      atrPct: 1,
      paramsVersionId: '1'
    });

    await mgr.onOrderFilled('p4');
    await mgr.onPrice('p4', 100.5);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 'position.paramDrift',
        reason: 'params_drift',
        paramsVersionId: '1'
      })
    );
  });

});

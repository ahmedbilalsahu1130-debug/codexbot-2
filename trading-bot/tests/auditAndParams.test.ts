import { AuditService } from '../src/audit/auditService.js';
import { ParamsService } from '../src/config/params.js';

describe('AuditService + ParamsService', () => {
  it('creates audit records with hashes', async () => {
    const prisma = {
      auditEvent: {
        create: jest.fn(async () => ({}))
      }
    };

    const audit = new AuditService(prisma as never);
    await audit.log({
      step: 'risk.decision',
      level: 'warn',
      message: 'reject',
      reason: 'cooldown',
      inputs: { symbol: 'BTCUSDT' },
      outputs: { status: 'REJECT' },
      paramsVersionId: '42',
      metadata: { engine: 'Breakout' }
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const arg = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data;
    expect(arg.step).toBe('risk.decision');
    expect(arg.inputsHash).toBeTruthy();
    expect(arg.outputsHash).toBeTruthy();
    expect(arg.paramsVersionId).toBe('42');
  });

  it('switches active params deterministically by effectiveFrom time', async () => {
    const t1 = new Date('2024-01-01T00:00:00Z');
    const t2 = new Date('2024-01-02T00:00:00Z');

    const prisma = {
      paramVersion: {
        findFirst: jest.fn(async ({ where }: { where: { effectiveFrom: { lte: Date } } }) => {
          if (where.effectiveFrom.lte.getTime() >= t2.getTime()) {
            return {
              id: 2n,
              effectiveFrom: t2,
              kb: 1.5,
              ks: 1.2,
              leverageBandsJson: { trend: [2, 3] },
              cooldownRulesJson: { engineMs: 1000 },
              portfolioCapsJson: { maxOpenPositions: 3 }
            };
          }

          return {
            id: 1n,
            effectiveFrom: t1,
            kb: 1.0,
            ks: 0.8,
            leverageBandsJson: { trend: [1, 2] },
            cooldownRulesJson: { engineMs: 5000 },
            portfolioCapsJson: { maxOpenPositions: 2 }
          };
        })
      }
    };

    const params = new ParamsService({ prisma: prisma as never, refreshIntervalMs: 0 });

    const oldParams = await params.getActiveParams(new Date('2024-01-01T12:00:00Z').getTime());
    const newParams = await params.getActiveParams(new Date('2024-01-02T12:00:00Z').getTime());

    expect(oldParams.paramsVersionId).toBe('1');
    expect(newParams.paramsVersionId).toBe('2');
    expect(oldParams.kb).not.toBe(newParams.kb);
  });
});

import { RegimeEngine, classifyRegime } from '../src/strategy/regimeEngine.js';
import { EventBus } from '../src/events/eventBus.js';

function makeFeature(overrides: Partial<Record<string, number | string>> = {}) {
  return {
    symbol: 'BTCUSDT',
    timeframe: '5m',
    closeTime: Number(overrides.closeTime ?? Date.now()),
    logReturn: Number(overrides.logReturn ?? 0.001),
    atrPct: Number(overrides.atrPct ?? 0.4),
    ewmaSigma: Number(overrides.ewmaSigma ?? 0.2),
    sigmaNorm: Number(overrides.sigmaNorm ?? 1),
    volPct5m: Number(overrides.volPct5m ?? 1),
    bbWidthPct: Number(overrides.bbWidthPct ?? 1),
    bbWidthPercentile: Number(overrides.bbWidthPercentile ?? 50),
    ema20: Number(overrides.ema20 ?? 100),
    ema50: Number(overrides.ema50 ?? 101),
    ema200: Number(overrides.ema200 ?? 99),
    ema50Slope: Number(overrides.ema50Slope ?? 0.01),
    volumePct: Number(overrides.volumePct ?? 100),
    volumePercentile: Number(overrides.volumePercentile ?? 40)
  };
}

describe('RegimeEngine', () => {
  it('classifies regime boundaries correctly', () => {
    expect(
      classifyRegime(
        { sigmaNormPct: 25, bbWidthPctile: 25, slopeAbsPctile: 20 },
        {
          compressionPercentileThreshold: 25,
          trendPercentileThreshold: 65,
          expansionPercentileThreshold: 85
        }
      )
    ).toBe('Compression');

    expect(
      classifyRegime(
        { sigmaNormPct: 90, bbWidthPctile: 90, slopeAbsPctile: 20 },
        {
          compressionPercentileThreshold: 25,
          trendPercentileThreshold: 65,
          expansionPercentileThreshold: 85
        }
      )
    ).toBe('ExpansionChaos');

    expect(
      classifyRegime(
        { sigmaNormPct: 65, bbWidthPctile: 40, slopeAbsPctile: 65 },
        {
          compressionPercentileThreshold: 25,
          trendPercentileThreshold: 65,
          expansionPercentileThreshold: 85
        }
      )
    ).toBe('Trend');

    expect(
      classifyRegime(
        { sigmaNormPct: 50, bbWidthPctile: 50, slopeAbsPctile: 50 },
        {
          compressionPercentileThreshold: 25,
          trendPercentileThreshold: 65,
          expansionPercentileThreshold: 85
        }
      )
    ).toBe('Range');
  });

  it('defensive threshold overrides engine selection', async () => {
    const bus = new EventBus();
    const emitted: unknown[] = [];
    bus.on('regime.updated', (payload) => emitted.push(payload));

    const prisma = {
      regimeDecision: {
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 1, ...create }))
      }
    };

    const engine = new RegimeEngine({
      prisma: prisma as never,
      eventBus: bus,
      defensiveVolumePercentileThreshold: 80,
      windowSize: 20
    });
    engine.subscribe();

    const now = Date.now() - 60_000;
    for (let i = 0; i < 10; i += 1) {
      bus.emit('features.ready',
        makeFeature({
          closeTime: now + i * 300_000,
          sigmaNorm: 0.8 + i * 0.01,
          bbWidthPct: 0.7 + i * 0.01,
          ema50Slope: 0.03 + i * 0.001,
          volumePercentile: i === 9 ? 95 : 50
        })
      );
    }

    await new Promise((resolve) => setImmediate(resolve));

    const last = emitted[emitted.length - 1] as { defensive: boolean; engine: string };
    expect(last.defensive).toBe(true);
    expect(last.engine).toBe('Defensive');
  });
});

import type { FeatureVector, RegimeDecision, TradePlan } from '../domain/models.js';
import { hashObject } from '../domain/models.js';
import type { EventBus } from '../events/eventBus.js';
import type { BreakoutEngine } from './engines/breakout.js';
import type { ContinuationEngine } from './engines/continuation.js';
import type { ReversalEngine } from './engines/reversal.js';

export type StrategyPlannerOptions = {
  eventBus: EventBus;
  breakoutEngine: BreakoutEngine;
  continuationEngine: ContinuationEngine;
  reversalEngine: ReversalEngine;
  defaultConfidence?: number;
};

export class StrategyPlanner {
  private readonly eventBus: EventBus;
  private readonly breakoutEngine: BreakoutEngine;
  private readonly continuationEngine: ContinuationEngine;
  private readonly reversalEngine: ReversalEngine;
  private readonly defaultConfidence: number;
  private readonly latestRegime = new Map<string, RegimeDecision>();

  constructor(options: StrategyPlannerOptions) {
    this.eventBus = options.eventBus;
    this.breakoutEngine = options.breakoutEngine;
    this.continuationEngine = options.continuationEngine;
    this.reversalEngine = options.reversalEngine;
    this.defaultConfidence = options.defaultConfidence ?? 0.6;
  }

  subscribe(): void {
    this.eventBus.on('regime.updated', async (regime) => {
      this.latestRegime.set(regime.symbol, regime);
    });

    this.eventBus.on('features.ready', async (feature) => {
      await this.onFeature(feature);
    });
  }

  async onFeature(feature: FeatureVector): Promise<void> {
    const regime = this.latestRegime.get(feature.symbol);
    if (!regime) {
      await this.emitReject('no_regime_for_symbol', feature, null);
      return;
    }

    if (regime.defensive) {
      await this.emitReject('defensive_mode', feature, regime);
      return;
    }

    if (feature.timeframe === '5m' && regime.closeTime5m !== feature.closeTime) {
      await this.emitReject('stale_regime_for_feature', feature, regime);
      return;
    }

    const evaluation = await this.evaluateSingleEngine(feature, regime);

    if (!evaluation.triggered) {
      await this.emitReject(evaluation.reason, feature, regime);
      return;
    }

    const normalizedPlan = this.normalizePlan(evaluation.plan);

    this.eventBus.emit('signal.generated', {
      tradePlan: normalizedPlan,
      feature,
      regime
    });
  }

  private async evaluateSingleEngine(
    feature: FeatureVector,
    regime: RegimeDecision
  ): Promise<{ triggered: false; reason: string } | { triggered: true; reason: string; plan: TradePlan }> {
    if (regime.regime === 'Compression') {
      if (feature.timeframe !== '1m') {
        return { triggered: false, reason: 'compression_requires_1m_feature' };
      }

      return this.breakoutEngine.evaluate(feature, regime);
    }

    if (regime.regime === 'Trend') {
      if (feature.timeframe !== '5m') {
        return { triggered: false, reason: 'trend_requires_5m_feature' };
      }

      return this.continuationEngine.evaluate(feature, regime);
    }

    if (regime.regime === 'Range') {
      if (feature.timeframe !== '5m') {
        return { triggered: false, reason: 'range_requires_5m_feature' };
      }

      return this.reversalEngine.evaluate(feature, regime);
    }

    return { triggered: false, reason: 'expansion_chaos_no_entry_engine' };
  }

  private normalizePlan(plan: TradePlan): TradePlan {
    const confidence = Math.max(0, Math.min(1, plan.confidence ?? this.defaultConfidence));

    return {
      ...plan,
      confidence,
      expiresAt: Math.max(Date.now(), plan.expiresAt)
    };
  }

  private async emitReject(reason: string, feature: FeatureVector, regime: RegimeDecision | null): Promise<void> {
    this.eventBus.emit('audit.event', {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      ts: Date.now(),
      step: 'strategyPlanner.reject',
      level: 'warn',
      message: reason,
      reason,
      inputsHash: hashObject({ feature, regime }),
      outputsHash: hashObject({ status: 'REJECT', reason }),
      paramsVersionId: 'baseline',
      metadata: {
        featureSymbol: feature.symbol,
        featureTimeframe: feature.timeframe,
        regime: regime?.regime ?? null,
        reason
      }
    });
  }
}

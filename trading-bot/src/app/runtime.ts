import pino, { type Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';

import { AuditService } from '../audit/auditService.js';
import { loadMexcEnv } from '../config/env.js';
import { loadConfig } from '../config/index.js';
import { ParamsService } from '../config/params.js';
import { MarketDataService } from '../data/marketDataService.js';
import { connectDatabase } from '../data/prisma.js';
import { FeatureService } from '../data/featureService.js';
import { EventBus } from '../events/eventBus.js';
import { ExecutionEngine } from '../execution/executionEngine.js';
import { PaperAdapter } from '../execution/paperAdapter.js';
import { PortfolioService } from '../portfolio/portfolioService.js';
import { PositionManager } from '../portfolio/positionManager.js';
import { RiskService } from '../risk/riskService.js';
import { BreakoutEngine } from '../strategy/engines/breakout.js';
import { ContinuationEngine } from '../strategy/engines/continuation.js';
import { ReversalEngine } from '../strategy/engines/reversal.js';
import { RegimeEngine } from '../strategy/regimeEngine.js';
import { StrategyPlanner } from '../strategy/strategyPlanner.js';
import { MexcClient } from '../mexc/client.js';

export type RuntimeOptions = {
  paperMode?: boolean;
  prisma?: PrismaClient;
  logger?: Logger;
  skipEnvLoad?: boolean;
};

export type RuntimeContext = {
  prisma: PrismaClient;
  eventBus: EventBus;
  auditService: AuditService;
  paramsService: ParamsService;
  marketDataService: MarketDataService;
  featureService: FeatureService;
  regimeEngine: RegimeEngine;
  breakoutEngine: BreakoutEngine;
  continuationEngine: ContinuationEngine;
  reversalEngine: ReversalEngine;
  strategyPlanner: StrategyPlanner;
  riskService: RiskService;
  portfolioService: PortfolioService;
  executionEngine: ExecutionEngine;
  positionManager: PositionManager;
  logger: Logger;
};

export async function bootRuntime(options: RuntimeOptions = {}): Promise<RuntimeContext> {
  const logger = options.logger ?? pino({ name: 'runtime' });
  const paperMode = options.paperMode ?? true;

  const boot = (step: string) => logger.info({ step }, `boot: ${step}`);

  try {
    boot('1.ConfigLoader');
    const appConfig = options.skipEnvLoad ? { LOG_LEVEL: 'info' } : loadConfig();
    const mexcEnv = options.skipEnvLoad
      ? {
          MEXC_API_KEY: 'paper',
          MEXC_API_SECRET: 'paper',
          MEXC_BASE_URL: 'https://api.mexc.com',
          RECV_WINDOW_MS: 5000
        }
      : loadMexcEnv();

    boot('2.PrismaClient');
    const prisma = options.prisma ?? (await connectDatabase());

    boot('3.AuditService');
    const auditService = new AuditService(prisma);

    boot('4.EventBus');
    const eventBus = new EventBus({ queueEmits: true });

    const paramsService = new ParamsService({ prisma });
    const activeParams = await paramsService.getActiveParams().catch(() => ({
      paramsVersionId: 'baseline',
      effectiveFrom: Date.now(),
      kb: 1,
      ks: 1,
      leverageBands: {},
      cooldownRules: {},
      portfolioCaps: {}
    }));

    boot('5.MarketDataService');
    const mexcClient = new MexcClient({ env: mexcEnv, logger: logger.child({ service: 'mexc' }) });
    const marketDataService = new MarketDataService({ prisma, mexcClient, eventBus });

    boot('6.FeatureService');
    const featureService = new FeatureService({ prisma, eventBus });

    boot('7.RegimeEngine');
    const regimeEngine = new RegimeEngine({ prisma, eventBus });

    boot('8.StrategyEngines');
    const breakoutEngine = new BreakoutEngine({ prisma, eventBus });
    const continuationEngine = new ContinuationEngine({ prisma, eventBus });
    const reversalEngine = new ReversalEngine({ prisma, eventBus });
    const strategyPlanner = new StrategyPlanner({
      eventBus,
      breakoutEngine,
      continuationEngine,
      reversalEngine,
      paramsService
    });

    boot('9.RiskService');
    const riskService = new RiskService({ prisma });

    boot('10.PortfolioService');
    const portfolioService = new PortfolioService({ prisma });
    riskService.setPortfolioService(portfolioService);

    boot('11.ExecutionEngine');
    const paperAdapter = new PaperAdapter();
    const executionEngine = new ExecutionEngine({
      prisma,
      exchange: paperAdapter,
      config: { fallbackMode: paperMode ? 'MARKET' : 'REPLACE_LIMIT' }
    });

    boot('12.PositionManager');
    const positionManager = new PositionManager({
      prisma,
      eventBus,
      auditService,
      getActiveParamsVersionId: async () => (await paramsService.getActiveParams()).paramsVersionId
    });

    const latestRegime = new Map<string, ReturnType<typeof regimeEngine.processFeature> extends Promise<infer R> ? R : never>();

    // Required runtime-only wiring
    eventBus.on('candle.closed', async (candle) => {
      await featureService.processClosedCandle(candle.symbol, candle.timeframe, candle.closeTime);
    });
    eventBus.on('features.ready', async (feature) => {
      if (feature.timeframe === '5m') {
        const decision = await regimeEngine.processFeature(feature);
        latestRegime.set(feature.symbol, decision);
      }

      await strategyPlanner.onFeature(feature);
    });

    eventBus.on('regime.updated', async (decision) => {
      latestRegime.set(decision.symbol, decision);
      logger.info({ symbol: decision.symbol, regime: decision.regime, engine: decision.engine }, 'StrategyPlanner regime update');
    });

    eventBus.on('signal.generated', async (signal) => {
      const riskDecision = await riskService.evaluatePlan(signal.tradePlan, signal.regime);
      if (riskDecision.status === 'APPROVE') {
        eventBus.emit('risk.approved', {
          plan: signal.tradePlan,
          signal,
          qty: riskDecision.qty,
          finalLeverage: riskDecision.finalLeverage,
          regime: signal.regime
        });
      } else {
        eventBus.emit('risk.rejected', {
          plan: signal.tradePlan,
          signal,
          reason: riskDecision.reason,
          regime: signal.regime
        });
      }
    });

    eventBus.on('risk.approved', async (approved) => {
      const result = await executionEngine.execute({
        plan: approved.plan,
        qty: approved.qty,
        confirmation: async () => true
      });

      const orderId = result.status === 'SKIPPED' ? result.orderId : result.orderId;

      eventBus.emit('order.submitted', {
        id: orderId,
        symbol: approved.plan.symbol,
        status: result.status === 'CANCELED' ? 'CANCELED' : 'OPEN',
        type: 'LIMIT',
        side: approved.plan.side,
        price: approved.plan.entryPrice,
        qty: approved.qty,
        createdAt: Date.now()
      });

      await positionManager.onOrderSubmitted({
        positionId: orderId,
        symbol: approved.plan.symbol,
        side: approved.plan.side,
        entryPrice: approved.plan.entryPrice,
        qty: approved.qty,
        atrPct: approved.signal.feature.atrPct,
        paramsVersionId: approved.plan.paramsVersionId
      });

      if (result.status === 'FILLED') {
        eventBus.emit('order.filled', {
          id: `fill-${orderId}`,
          orderId,
          price: result.fillPrice,
          qty: approved.qty,
          fee: 0,
          ts: Date.now()
        });
      }

      if (result.status === 'CANCELED') {
        eventBus.emit('order.canceled', { orderId, reason: result.reason });
      }
    });

    eventBus.on('order.filled', async (fill) => {
      await positionManager.onOrderFilledEvent(fill.orderId);
    });

    eventBus.on('order.canceled', async (payload) => {
      await positionManager.onOrderCanceled(payload.orderId);
    });

    eventBus.on('position.updated', async (position) => {
      await auditService.log({
        step: 'position.updated',
        level: 'info',
        message: 'position updated',
        inputs: { id: position.id, symbol: position.symbol },
        outputs: position,
        paramsVersionId: activeParams.paramsVersionId,
        metadata: { module: 'positionManager' }
      });
    });

    eventBus.on('position.closed', async (payload) => {
      await auditService.log({
        step: 'position.closed',
        level: 'warn',
        message: 'position closed',
        reason: payload.reason,
        inputs: payload,
        outputs: { status: 'closed' },
        paramsVersionId: activeParams.paramsVersionId,
        metadata: { module: 'positionManager' }
      });
    });

    logger.level = appConfig.LOG_LEVEL;

    return {
      prisma,
      eventBus,
      auditService,
      paramsService,
      marketDataService,
      featureService,
      regimeEngine,
      breakoutEngine,
      continuationEngine,
      reversalEngine,
      strategyPlanner,
      riskService,
      portfolioService,
      executionEngine,
      positionManager,
      logger
    };
  } catch (error) {
    logger.error({ err: error }, 'runtime boot failed');
    throw error;
  }
}

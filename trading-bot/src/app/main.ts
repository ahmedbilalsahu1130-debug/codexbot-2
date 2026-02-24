import { loadMexcEnv } from '../config/env.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../config/logger.js';
import { connectDatabase } from '../data/prisma.js';
import { FeatureService } from '../data/featureService.js';
import { MarketDataService } from '../data/marketDataService.js';
import { EventBus } from '../events/eventBus.js';
import { MexcClient } from '../mexc/client.js';
import { BreakoutEngine } from '../strategy/engines/breakout.js';
import { ContinuationEngine } from '../strategy/engines/continuation.js';
import { RegimeEngine } from '../strategy/regimeEngine.js';
import { ReversalEngine } from '../strategy/engines/reversal.js';

export async function bootstrap() {
  const config = loadConfig();
  const logger = createLogger(config);
  const prisma = await connectDatabase();

  const mexcEnv = loadMexcEnv();
  const eventBus = new EventBus({ queueEmits: true });

  eventBus.on('candle.closed', (candle) => {
    logger.info({ symbol: candle.symbol, timeframe: candle.timeframe, closeTime: candle.closeTime }, 'candle.closed');
  });

  eventBus.on('audit.event', (audit) => {
    logger.warn({ step: audit.step, message: audit.message }, 'market data audit event');
  });

  const mexcClient = new MexcClient({ env: mexcEnv, logger });
  const marketDataService = new MarketDataService({ prisma, mexcClient, eventBus });
  const featureService = new FeatureService({ prisma, eventBus });
  featureService.subscribe();
  const regimeEngine = new RegimeEngine({ prisma, eventBus });
  regimeEngine.subscribe();
  const breakoutEngine = new BreakoutEngine({ prisma, eventBus });
  breakoutEngine.subscribe();
  const continuationEngine = new ContinuationEngine({ prisma, eventBus });
  continuationEngine.subscribe();
  const reversalEngine = new ReversalEngine({ prisma, eventBus });
  reversalEngine.subscribe();

  eventBus.on('features.ready', (feature) => {
    logger.info({ symbol: feature.symbol, timeframe: feature.timeframe, closeTime: feature.closeTime }, 'features.ready');
  });

  eventBus.on('regime.updated', (decision) => {
    logger.info({ symbol: decision.symbol, regime: decision.regime, engine: decision.engine }, 'regime.updated');
  });

  eventBus.on('signal.generated', (signal) => {
    logger.info({ symbol: signal.tradePlan.symbol, side: signal.tradePlan.side, engine: signal.tradePlan.engine }, 'signal.generated');
  });

  logger.info('Bot booted');

  // Paper-mode example runner: fetch two symbols and emit closed-candle events.
  await marketDataService.poll(['BTCUSDT', 'ETHUSDT'], '1m', 50);

  return { config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error: unknown) => {
    console.error('Failed to boot bot', error);
    process.exit(1);
  });
}

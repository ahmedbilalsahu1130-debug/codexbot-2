import { loadMexcEnv } from '../config/env.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../config/logger.js';
import { connectDatabase } from '../data/prisma.js';
import { MarketDataService } from '../data/marketDataService.js';
import { EventBus } from '../events/eventBus.js';
import { MexcClient } from '../mexc/client.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../config/logger.js';
import { connectDatabase } from '../data/prisma.js';

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

  logger.info('Bot booted');

  // Paper-mode example runner: fetch two symbols and emit closed-candle events.
  await marketDataService.poll(['BTCUSDT', 'ETHUSDT'], '1m', 50);


  await connectDatabase();

  logger.info('Bot booted');
  return { config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error: unknown) => {
    console.error('Failed to boot bot', error);
    process.exit(1);
  });
}

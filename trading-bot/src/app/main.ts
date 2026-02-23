import { loadConfig } from '../config/index.js';
import { createLogger } from '../config/logger.js';
import { connectDatabase } from '../data/prisma.js';

export async function bootstrap() {
  const config = loadConfig();
  const logger = createLogger(config);

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

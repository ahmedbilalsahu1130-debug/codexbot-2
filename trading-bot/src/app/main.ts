import { bootRuntime } from './runtime.js';

export async function bootstrap() {
  const runtime = await bootRuntime({ paperMode: true });
  runtime.logger.info('Bot booted');

  // Paper-mode example runner.
  await runtime.marketDataService.poll(['BTCUSDT', 'ETHUSDT'], '1m', 50);

  return runtime;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error: unknown) => {
    console.error('Failed to boot bot', error);
    process.exit(1);
  });
}

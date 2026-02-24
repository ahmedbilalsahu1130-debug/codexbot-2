import pino, { type LoggerOptions } from 'pino';

import type { AppConfig } from './schema.js';

export function createLogger(config: AppConfig) {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    base: {
      service: 'trading-bot'
    }
  };

  return pino(options);
}

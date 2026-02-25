import dotenv from 'dotenv';

import { envSchema, type AppConfig } from './schema.js';

dotenv.config();

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return result.data;
}

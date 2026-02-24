import { envSchema } from '../src/config/schema.js';

describe('envSchema', () => {
  it('validates required environment variables', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/trading_bot'
    });

    expect(result.success).toBe(true);
  });
});

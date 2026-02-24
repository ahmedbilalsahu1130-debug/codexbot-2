import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

export const mexcEnvSchema = z.object({
  MEXC_API_KEY: z.string().min(1, 'MEXC_API_KEY is required'),
  MEXC_API_SECRET: z.string().min(1, 'MEXC_API_SECRET is required'),
  MEXC_BASE_URL: z.string().url().default('https://api.mexc.com'),
  RECV_WINDOW_MS: z.coerce.number().int().positive().default(5000)
});

export type MexcEnv = z.infer<typeof mexcEnvSchema>;

export function loadMexcEnv(env: NodeJS.ProcessEnv = process.env): MexcEnv {
  const parsed = mexcEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid MEXC environment configuration: ${parsed.error.message}`);
  }

  return parsed.data;
}

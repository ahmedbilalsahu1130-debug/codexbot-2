import { createHmac } from 'node:crypto';

import Bottleneck from 'bottleneck';
import pRetry, { AbortError } from 'p-retry';
import type { Logger } from 'pino';
import pino from 'pino';
import { fetch, type RequestInit } from 'undici';

import type { MexcEnv } from '../config/env.js';

type Primitive = string | number | boolean;
export type QueryParams = Record<string, Primitive | undefined>;

export type MexcClientOptions = {
  env: MexcEnv;
  logger?: Logger;
  rateLimitRps?: number;
  requestTimeoutMs?: number;
  retryCount?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RATE_LIMIT_RPS = 10;

export function buildSortedQueryString(params: QueryParams = {}): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    query.set(key, String(value));
  }

  return query.toString();
}

export function signMexcPayload(accessKey: string, timestamp: string, paramString: string, secret: string): string {
  const payload = `${accessKey}${timestamp}${paramString}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class MexcClient {
  private readonly env: MexcEnv;
  private readonly logger: Logger;
  private readonly limiter: Bottleneck;
  private readonly requestTimeoutMs: number;
  private readonly retryCount: number;
  private serverTimeOffsetMs = 0;

  constructor(options: MexcClientOptions) {
    this.env = options.env;
    this.logger = options.logger ?? pino({ name: 'mexc-client' });
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

    const rateLimitRps = options.rateLimitRps ?? DEFAULT_RATE_LIMIT_RPS;
    const minTimeMs = Math.ceil(1000 / Math.max(1, rateLimitRps));
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: minTimeMs });
  }

  async publicGet<TResponse>(path: string, params: QueryParams = {}): Promise<TResponse> {
    const query = buildSortedQueryString(params);
    const fullPath = query ? `${path}?${query}` : path;

    return this.withRetry(() => this.scheduleRequest<TResponse>(fullPath, { method: 'GET' }), 'publicGet');
  }

  async privateGet<TResponse>(path: string, params: QueryParams = {}): Promise<TResponse> {
    const timestamp = this.getRequestTimestamp();
    const paramString = buildSortedQueryString(params);
    const signature = signMexcPayload(this.env.MEXC_API_KEY, timestamp, paramString, this.env.MEXC_API_SECRET);

    const query = paramString ? `?${paramString}` : '';
    return this.withRetry(
      () =>
        this.scheduleRequest<TResponse>(`${path}${query}`, {
          method: 'GET',
          headers: this.buildPrivateHeaders(timestamp, signature)
        }),
      'privateGet'
    );
  }

  async privatePost<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
    const timestamp = this.getRequestTimestamp();
    const rawBody = JSON.stringify(body);
    const signature = signMexcPayload(this.env.MEXC_API_KEY, timestamp, rawBody, this.env.MEXC_API_SECRET);

    return this.withRetry(
      () =>
        this.scheduleRequest<TResponse>(path, {
          method: 'POST',
          headers: {
            ...this.buildPrivateHeaders(timestamp, signature),
            'Content-Type': 'application/json'
          },
          body: rawBody
        }),
      'privatePost'
    );
  }

  async synchronizeServerTimeOffset(timePath = '/api/v3/time'): Promise<number> {
    const response = await this.publicGet<{ serverTime: number }>(timePath);

    if (!Number.isFinite(response.serverTime)) {
      throw new Error('Invalid server time response from MEXC');
    }

    this.serverTimeOffsetMs = response.serverTime - Date.now();
    this.logger.info({ offsetMs: this.serverTimeOffsetMs }, 'MEXC server time offset synchronized');
    return this.serverTimeOffsetMs;
  }

  private getRequestTimestamp(): string {
    return String(Date.now() + this.serverTimeOffsetMs);
  }

  private buildPrivateHeaders(timestamp: string, signature: string): Record<string, string> {
    return {
      ApiKey: this.env.MEXC_API_KEY,
      'Request-Time': timestamp,
      Signature: signature,
      'Recv-Window': String(this.env.RECV_WINDOW_MS)
    };
  }

  private async withRetry<T>(fn: () => Promise<T>, action: string): Promise<T> {
    return pRetry(fn, {
      retries: this.retryCount,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 2000,
      onFailedAttempt: (error) => {
        this.logger.warn(
          {
            action,
            attemptNumber: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            errorMessage: error.message
          },
          'MEXC request attempt failed'
        );
      },
      shouldRetry: (error) => this.isRetryableError(error)
    });
  }

  private async scheduleRequest<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
    return this.limiter.schedule(async () => {
      const url = new URL(path, this.env.MEXC_BASE_URL).toString();

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        this.logger.debug({ method: init.method, path }, 'Sending MEXC request');

        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new MexcHttpError(response.status, bodyText || response.statusText);
        }

        return (await response.json()) as TResponse;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw new MexcNetworkError('Request timeout reached');
        }

        throw error;
      } finally {
        clearTimeout(timeoutHandle);
      }
    });
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof AbortError) {
      return false;
    }

    if (error instanceof MexcHttpError) {
      return error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode < 600);
    }

    if (error instanceof MexcNetworkError) {
      return true;
    }

    if (error instanceof TypeError) {
      return true;
    }

    return false;
  }
}

class MexcHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'MexcHttpError';
    this.statusCode = statusCode;
  }
}

class MexcNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MexcNetworkError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

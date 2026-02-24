import nock from 'nock';

import { MexcClient, signMexcPayload } from '../src/mexc/client.js';

describe('MexcClient', () => {
  const baseUrl = 'https://api.mexc.com';

  afterEach(() => {
    nock.cleanAll();
  });

  it('generates expected signature for known vector', () => {
    const signature = signMexcPayload('myAccessKey', '1700000000000', 'symbol=BTCUSDT&limit=1', 'mySecret');

    expect(signature).toBe('1ffb0f3b4aa2b4046d25cc04bb27a3437ee685d93405ea2e47fcdc42d6d3e509');
  });

  it('retries request when API responds with 429', async () => {
    const scope = nock(baseUrl)
      .get('/api/v3/ping')
      .reply(429, { code: 429, msg: 'Too many requests' })
      .get('/api/v3/ping')
      .reply(200, { ok: true });

    const client = new MexcClient({
      env: {
        MEXC_API_KEY: 'k',
        MEXC_API_SECRET: 's',
        MEXC_BASE_URL: baseUrl,
        RECV_WINDOW_MS: 5000
      },
      retryCount: 2,
      rateLimitRps: 100
    });

    const response = await client.publicGet<{ ok: boolean }>('/api/v3/ping');

    expect(response.ok).toBe(true);
    expect(scope.isDone()).toBe(true);
  });

  it('applies rate limiter throughput', async () => {
    nock(baseUrl).get('/api/v3/ping').times(3).reply(200, { ok: true });

    const client = new MexcClient({
      env: {
        MEXC_API_KEY: 'k',
        MEXC_API_SECRET: 's',
        MEXC_BASE_URL: baseUrl,
        RECV_WINDOW_MS: 5000
      },
      retryCount: 0,
      rateLimitRps: 2
    });

    const started = Date.now();
    await Promise.all([
      client.publicGet('/api/v3/ping'),
      client.publicGet('/api/v3/ping'),
      client.publicGet('/api/v3/ping')
    ]);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});

import { FetchRetry } from '../src/integrations';
import fs from 'fs';
import path from 'path';

const TEST_LOG_PATH = path.join(__dirname, 'fetch-retry-test.json');

describe('FetchRetry body serialization', () => {
  let fetchRetry: FetchRetry;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
    fetchRetry = new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH);
    fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  it('JSON-stringifies plain object bodies and sets Content-Type', async () => {
    await fetchRetry.post('/data', { hello: 'world' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('passes FormData through untouched without forcing Content-Type', async () => {
    const form = new FormData();
    form.append('file', 'contents');

    await fetchRetry.post('/upload', form);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers).toBeUndefined();
  });

  it('passes URLSearchParams through untouched', async () => {
    const params = new URLSearchParams({ a: '1' });

    await fetchRetry.post('/form', params);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(params);
  });

  it('passes an already-serialized string body through untouched', async () => {
    const raw = '{"already":"json"}';

    await fetchRetry.post('/raw', raw);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(raw);
    expect(init.headers).toBeUndefined();
  });

  it('does not force a body or Content-Type when none is provided', async () => {
    await fetchRetry.delete('/thing');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it('applies the same handling for put and patch', async () => {
    const form = new FormData();

    await fetchRetry.put('/upload', form);
    let [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);

    await fetchRetry.patch('/data', { hello: 'world' });
    [, init] = fetchMock.mock.calls[1];
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});

describe('FetchRetry failure logging', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  it('records the real url, method, headers, and body for a failed POST', async () => {
    fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 500 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const fetchRetry = new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH);

    await expect(fetchRetry.post('/orders', { id: 1 })).rejects.toThrow();

    const [failure] = await fetchRetry.getRetryManager().getFailedRequests();
    expect(failure.url).toBe('/orders');
    expect(failure.method).toBe('POST');
    expect(failure.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(failure.body).toBe(JSON.stringify({ id: 1 }));
    expect(failure.statusCode).toBe(500);
  });

  it('records the real url and method for a failed DELETE', async () => {
    fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const fetchRetry = new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH);

    await expect(fetchRetry.delete('/orders/1')).rejects.toThrow();

    const [failure] = await fetchRetry.getRetryManager().getFailedRequests();
    expect(failure.url).toBe('/orders/1');
    expect(failure.method).toBe('DELETE');
  });

  it('records the url and method even when fetch itself throws a network error', async () => {
    fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const fetchRetry = new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH);

    await expect(fetchRetry.get('/status')).rejects.toThrow('fetch failed');

    const [failure] = await fetchRetry.getRetryManager().getFailedRequests();
    expect(failure.url).toBe('/status');
    expect(failure.method).toBe('GET');
    expect(failure.error).toBe('fetch failed');
  });

  it('does not crash on construction or use when the filesystem is unavailable', async () => {
    fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('fs unavailable');
    });
    const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('fs unavailable');
    });

    try {
      expect(() => new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH)).not.toThrow();

      const unusableFsRetry = new FetchRetry({ maxRetries: 1 }, TEST_LOG_PATH);
      const response = await unusableFsRetry.get('/status');
      expect(response.status).toBe(200);
    } finally {
      existsSyncSpy.mockRestore();
      writeFileSyncSpy.mockRestore();
    }
  });
});

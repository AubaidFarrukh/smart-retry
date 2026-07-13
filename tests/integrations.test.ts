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

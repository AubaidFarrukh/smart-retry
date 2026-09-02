import { AxiosRetry, FetchRetry } from '../src/integrations';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const TEST_LOG_PATH = path.join(__dirname, 'fetch-retry-test.json');
const AXIOS_TEST_LOG_PATH = path.join(__dirname, 'axios-retry-test.json');

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

describe('AxiosRetry', () => {
  let axiosRetry: AxiosRetry;

  beforeEach(() => {
    if (fs.existsSync(AXIOS_TEST_LOG_PATH)) {
      fs.unlinkSync(AXIOS_TEST_LOG_PATH);
    }
    mockedAxios.request = jest.fn();
    axiosRetry = new AxiosRetry({ maxRetries: 1 }, AXIOS_TEST_LOG_PATH);
  });

  afterEach(() => {
    if (fs.existsSync(AXIOS_TEST_LOG_PATH)) {
      fs.unlinkSync(AXIOS_TEST_LOG_PATH);
    }
  });

  it('resolves with the axios response on a successful request', async () => {
    const response = { data: { hello: 'world' }, status: 200 };
    mockedAxios.request.mockResolvedValue(response);

    const result = await axiosRetry.get('/data');

    expect(result).toBe(response);
  });

  it('passes the right method, url, and data through to axios.request for get/post/put/delete/patch', async () => {
    mockedAxios.request.mockResolvedValue({ data: null, status: 200 });

    await axiosRetry.get('/items');
    expect(mockedAxios.request).toHaveBeenLastCalledWith({ method: 'GET', url: '/items' });

    await axiosRetry.post('/items', { name: 'a' });
    expect(mockedAxios.request).toHaveBeenLastCalledWith({
      method: 'POST',
      url: '/items',
      data: { name: 'a' },
    });

    await axiosRetry.put('/items/1', { name: 'b' });
    expect(mockedAxios.request).toHaveBeenLastCalledWith({
      method: 'PUT',
      url: '/items/1',
      data: { name: 'b' },
    });

    await axiosRetry.delete('/items/1');
    expect(mockedAxios.request).toHaveBeenLastCalledWith({ method: 'DELETE', url: '/items/1' });

    await axiosRetry.patch('/items/1', { name: 'c' });
    expect(mockedAxios.request).toHaveBeenLastCalledWith({
      method: 'PATCH',
      url: '/items/1',
      data: { name: 'c' },
    });
  });

  it('retries per RetryConfig and eventually throws when every attempt fails', async () => {
    const error: any = new Error('Request failed with status code 500');
    error.response = { status: 500, statusText: 'Internal Server Error' };
    error.config = {
      url: '/orders',
      method: 'post',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ id: 1 }),
    };
    mockedAxios.request.mockRejectedValue(error);

    const retryingAxios = new AxiosRetry({ maxRetries: 3, delay: 0 }, AXIOS_TEST_LOG_PATH);

    await expect(retryingAxios.post('/orders', { id: 1 })).rejects.toThrow(
      'Request failed with status code 500'
    );
    expect(mockedAxios.request).toHaveBeenCalledTimes(3);
  });

  it('logs a failed request via getRetryManager().getFailedRequests() once retries are exhausted', async () => {
    const error: any = new Error('Request failed with status code 500');
    error.response = { status: 500, statusText: 'Internal Server Error' };
    error.config = {
      url: '/orders',
      method: 'post',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ id: 1 }),
    };
    mockedAxios.request.mockRejectedValue(error);

    await expect(axiosRetry.post('/orders', { id: 1 })).rejects.toThrow();

    const [failure] = await axiosRetry.getRetryManager().getFailedRequests();
    expect(failure.url).toBe('/orders');
    expect(failure.method).toBe('POST');
    expect(failure.statusCode).toBe(500);
  });
});

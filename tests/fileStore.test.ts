import { FileStore } from '../src/fileStore';
import { FailedRequest } from '../src/types';
import fs from 'fs';
import path from 'path';

const TEST_LOG_PATH = path.join(__dirname, 'test-store.json');

describe('FileStore', () => {
  let store: FileStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
    store = new FileStore(TEST_LOG_PATH);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  it('should create log file on initialization', () => {
    expect(fs.existsSync(TEST_LOG_PATH)).toBe(true);
  });

  it('should save failed requests', async () => {
    const request: FailedRequest = {
      id: 'test-123',
      url: 'https://api.example.com/data',
      method: 'GET',
      error: 'Timeout',
      attempts: 3,
      totalDuration: 6000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request);
    const logs = await store.loadAll();

    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('test-123');
    expect(logs[0].url).toBe('https://api.example.com/data');
  });

  it('should load all failed requests', async () => {
    const request1: FailedRequest = {
      id: 'test-1',
      url: 'https://api.example.com/1',
      method: 'GET',
      error: 'Error 1',
      attempts: 2,
      totalDuration: 3000,
      timestamp: new Date().toISOString(),
    };

    const request2: FailedRequest = {
      id: 'test-2',
      url: 'https://api.example.com/2',
      method: 'POST',
      error: 'Error 2',
      attempts: 3,
      totalDuration: 5000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request1);
    await store.save(request2);

    const logs = await store.loadAll();
    expect(logs).toHaveLength(2);
  });

  it('should find request by ID', async () => {
    const request: FailedRequest = {
      id: 'find-me',
      url: 'https://api.example.com/data',
      method: 'GET',
      error: 'Error',
      attempts: 1,
      totalDuration: 1000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request);
    const found = await store.findById('find-me');

    expect(found).toBeDefined();
    expect(found?.id).toBe('find-me');
  });

  it('should return undefined for non-existent ID', async () => {
    const found = await store.findById('does-not-exist');
    expect(found).toBeUndefined();
  });

  it('should remove request by ID', async () => {
    const request: FailedRequest = {
      id: 'remove-me',
      url: 'https://api.example.com/data',
      method: 'GET',
      error: 'Error',
      attempts: 1,
      totalDuration: 1000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request);
    const removed = await store.remove('remove-me');

    expect(removed).toBe(true);
    const logs = await store.loadAll();
    expect(logs).toHaveLength(0);
  });

  it('should return false when removing non-existent ID', async () => {
    const removed = await store.remove('does-not-exist');
    expect(removed).toBe(false);
  });

  it('should clear all requests', async () => {
    const request1: FailedRequest = {
      id: 'test-1',
      url: 'https://api.example.com/1',
      method: 'GET',
      error: 'Error',
      attempts: 1,
      totalDuration: 1000,
      timestamp: new Date().toISOString(),
    };

    const request2: FailedRequest = {
      id: 'test-2',
      url: 'https://api.example.com/2',
      method: 'GET',
      error: 'Error',
      attempts: 1,
      totalDuration: 1000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request1);
    await store.save(request2);
    await store.clear();

    const logs = await store.loadAll();
    expect(logs).toHaveLength(0);
  });

  it('should count requests', async () => {
    expect(await store.count()).toBe(0);

    const request: FailedRequest = {
      id: 'test-1',
      url: 'https://api.example.com/1',
      method: 'GET',
      error: 'Error',
      attempts: 1,
      totalDuration: 1000,
      timestamp: new Date().toISOString(),
    };

    await store.save(request);
    expect(await store.count()).toBe(1);
  });

  it('should return correct file path', () => {
    expect(store.getFilePath()).toBe(TEST_LOG_PATH);
  });
});

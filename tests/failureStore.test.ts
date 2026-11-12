import fs from 'fs';
import path from 'path';
import { RetryManager } from '../src/retryManager';
import { FileStore } from '../src/fileStore';
import { createRetryManager } from '../src/index';
import { createAxiosRetry, createFetchRetry } from '../src/integrations';
import { FailedRequest, FailureStore } from '../src/types';

class InMemoryStore implements FailureStore {
  private requests: FailedRequest[] = [];

  async save(request: FailedRequest): Promise<void> {
    this.requests.push(request);
  }

  async loadAll(): Promise<FailedRequest[]> {
    return [...this.requests];
  }

  async findById(id: string): Promise<FailedRequest | undefined> {
    return this.requests.find((request) => request.id === id);
  }

  async remove(id: string): Promise<boolean> {
    const before = this.requests.length;
    this.requests = this.requests.filter((request) => request.id !== id);
    return this.requests.length < before;
  }

  async clear(): Promise<void> {
    this.requests = [];
  }

  async count(): Promise<number> {
    return this.requests.length;
  }
}

describe('FailureStore (pluggable failure-log storage)', () => {
  it('FileStore implements the FailureStore interface', () => {
    const store: FailureStore = new FileStore(path.join(__dirname, 'failure-store-check.json'));
    expect(typeof store.save).toBe('function');
    expect(typeof store.loadAll).toBe('function');
    expect(typeof store.findById).toBe('function');
    expect(typeof store.remove).toBe('function');
    expect(typeof store.clear).toBe('function');
    expect(typeof store.count).toBe('function');
    if (fs.existsSync(path.join(__dirname, 'failure-store-check.json'))) {
      fs.unlinkSync(path.join(__dirname, 'failure-store-check.json'));
    }
  });

  it('receives failed requests through RetryManager.execute()', async () => {
    const store = new InMemoryStore();
    const manager = new RetryManager({ maxRetries: 1, delay: 10 }, store);

    const result = await manager.execute(async () => {
      throw new Error('Down');
    });

    expect(result.success).toBe(false);
    expect(await store.count()).toBe(1);
    const logged = await store.loadAll();
    expect(logged).toHaveLength(1);
    expect(logged[0].error).toBe('Down');
  });

  it('serves manager delegation methods from the custom store', async () => {
    const store = new InMemoryStore();
    const manager = new RetryManager({ maxRetries: 1, delay: 10 }, store);

    await manager.execute(async () => {
      throw new Error('Down');
    });

    expect(await manager.getFailedRequestCount()).toBe(1);
    const all = await manager.getFailedRequests();
    expect(all).toHaveLength(1);
    expect(await manager.getFailedRequest(all[0].id)).toEqual(all[0]);
    expect(await manager.removeFailedRequest(all[0].id)).toBe(true);
    expect(await manager.getFailedRequestCount()).toBe(0);

    await manager.execute(async () => {
      throw new Error('Down again');
    });
    expect(await manager.getFailedRequestCount()).toBe(1);
    await manager.clearFailedRequests();
    expect(await manager.getFailedRequestCount()).toBe(0);
  });

  it('does not let a rejecting custom store break execute()', async () => {
    const rejectingStore: FailureStore = {
      save: async () => {
        throw new Error('store unavailable');
      },
      loadAll: async () => [],
      findById: async () => undefined,
      remove: async () => false,
      clear: async () => {},
      count: async () => 0,
    };
    const manager = new RetryManager({ maxRetries: 2, delay: 10 }, rejectingStore);

    let attempts = 0;
    const result = await manager.execute(async () => {
      attempts++;
      const error: any = new Error('Persistent failure');
      error.response = { status: 503 };
      throw error;
    });

    expect(result.success).toBe(false);
    expect(result.error.message).toBe('Persistent failure');
    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
  });

  it('propagates read delegation errors from a custom store', async () => {
    const failingStore: FailureStore = {
      save: async () => {},
      loadAll: async () => {
        throw new Error('read failed');
      },
      findById: async () => {
        throw new Error('read failed');
      },
      remove: async () => {
        throw new Error('read failed');
      },
      clear: async () => {},
      count: async () => {
        throw new Error('read failed');
      },
    };
    const manager = new RetryManager({ maxRetries: 1, delay: 10 }, failingStore);

    await expect(manager.getFailedRequests()).rejects.toThrow('read failed');
    await expect(manager.getFailedRequest('any-id')).rejects.toThrow('read failed');
    await expect(manager.removeFailedRequest('any-id')).rejects.toThrow('read failed');
    await expect(manager.getFailedRequestCount()).rejects.toThrow('read failed');
  });

  it('throws a TypeError for an invalid store', () => {
    expect(() => new RetryManager({}, {} as any)).toThrow(TypeError);
    expect(() => new RetryManager({}, { save: async () => {} } as any)).toThrow(TypeError);
    expect(() => new RetryManager({}, 123 as any)).toThrow(TypeError);
  });

  it('throws when both a store instance and storeConfig are passed', () => {
    const store = new InMemoryStore();
    expect(() => new RetryManager({}, store, { maxFiles: 2 })).toThrow(Error);
    expect(() => createRetryManager({}, store, { maxFiles: 2 })).toThrow(Error);
  });

  it('returns undefined from getLogFilePath() for a custom store', () => {
    const manager = new RetryManager({}, new InMemoryStore());
    expect(manager.getLogFilePath()).toBeUndefined();
  });

  it('returns undefined from getLogFilePath() for a custom store that exposes getFilePath', () => {
    const storeWithPath = new InMemoryStore() as InMemoryStore & {
      getFilePath: () => string;
    };
    storeWithPath.getFilePath = () => '/tmp/not-a-file-store.json';
    const manager = new RetryManager({}, storeWithPath);
    expect(manager.getLogFilePath()).toBeUndefined();
  });

  it('still returns the file path for a file-backed store', () => {
    const logPath = path.join(__dirname, 'failure-store-path.json');
    try {
      const manager = new RetryManager({}, logPath);
      expect(manager.getLogFilePath()).toBe(logPath);
    } finally {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
    }
  });

  it('keeps the default FileStore path unchanged', () => {
    const defaultPath = path.join(process.cwd(), 'smart-retry-log.json');
    try {
      const manager = new RetryManager({});
      expect(manager.getLogFilePath()).toBe(defaultPath);
    } finally {
      if (fs.existsSync(defaultPath)) {
        fs.unlinkSync(defaultPath);
      }
    }
  });

  it('works through createRetryManager with a store instance', async () => {
    const store = new InMemoryStore();
    const manager = createRetryManager({ maxRetries: 1, delay: 10 }, store);

    await manager.execute(async () => {
      throw new Error('Down');
    });

    expect(await manager.getFailedRequestCount()).toBe(1);
    expect(manager.getLogFilePath()).toBeUndefined();
  });

  it('works through createAxiosRetry and createFetchRetry with a store instance', async () => {
    const axiosStore = new InMemoryStore();
    const axiosRetry = createAxiosRetry({ maxRetries: 1, delay: 10 }, axiosStore);
    expect(axiosRetry.getRetryManager().getLogFilePath()).toBeUndefined();
    await axiosRetry.getRetryManager().execute(async () => {
      throw new Error('Down');
    });
    expect(await axiosStore.count()).toBe(1);

    const fetchStore = new InMemoryStore();
    const fetchRetry = createFetchRetry({ maxRetries: 1, delay: 10 }, fetchStore);
    expect(fetchRetry.getRetryManager().getLogFilePath()).toBeUndefined();
    await fetchRetry.getRetryManager().execute(async () => {
      throw new Error('Down');
    });
    expect(await fetchStore.count()).toBe(1);
  });

  it('still accepts a string path through createRetryManager', () => {
    const logPath = path.join(__dirname, 'failure-store-create.json');
    try {
      const manager = createRetryManager({}, logPath);
      expect(manager.getLogFilePath()).toBe(logPath);
    } finally {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
    }
  });
});

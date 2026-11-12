import { FileStore } from '../src/fileStore';
import { FailedRequest } from '../src/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

  describe('when the filesystem is unavailable', () => {
    let existsSyncSpy: jest.SpyInstance;
    let writeFileSyncSpy: jest.SpyInstance;
    let readFileSyncSpy: jest.SpyInstance;

    beforeEach(() => {
      existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('fs unavailable');
      });
      writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('EROFS: read-only file system');
      });
      readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('fs unavailable');
      });
    });

    afterEach(() => {
      existsSyncSpy.mockRestore();
      writeFileSyncSpy.mockRestore();
      readFileSyncSpy.mockRestore();
    });

    it('should not throw on construction', () => {
      expect(() => new FileStore(TEST_LOG_PATH)).not.toThrow();
    });

    it('should degrade to a no-op instead of rejecting', async () => {
      const unusableStore = new FileStore(TEST_LOG_PATH);
      const request: FailedRequest = {
        id: 'test-1',
        url: 'https://api.example.com/1',
        method: 'GET',
        error: 'Error',
        attempts: 1,
        totalDuration: 1000,
        timestamp: new Date().toISOString(),
      };

      await expect(unusableStore.save(request)).resolves.toBeUndefined();
      await expect(unusableStore.loadAll()).resolves.toEqual([]);
      await expect(unusableStore.remove('test-1')).resolves.toBe(false);
      await expect(unusableStore.clear()).resolves.toBeUndefined();
      await expect(unusableStore.count()).resolves.toBe(0);
    });
  });

  describe('concurrent write serialization', () => {
    const createFailedRequest = (id: string): FailedRequest => ({
      id,
      url: `https://api.example.com/${id}`,
      method: 'GET',
      error: 'Timeout',
      attempts: 3,
      totalDuration: 6000,
      timestamp: new Date().toISOString(),
    });

    it('should serialize concurrent saves on one FileStore without dropping entries', async () => {
      for (let iteration = 0; iteration < 5; iteration++) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-concurrent-'));
        const logPath = path.join(tempDir, 'test-store.json');
        try {
          const fileStore = new FileStore(logPath);
          const savePromises = Array.from({ length: 20 }, (_, i) =>
            fileStore.save(createFailedRequest(`req-${iteration}-${i}`))
          );
          await Promise.all(savePromises);

          const logs = await fileStore.loadAll();
          expect(logs).toHaveLength(20);
          expect(await fileStore.count()).toBe(20);

          const savedIds = new Set(logs.map((log) => log.id));
          for (let i = 0; i < 20; i++) {
            expect(savedIds.has(`req-${iteration}-${i}`)).toBe(true);
          }
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it('should serialize concurrent saves across multiple FileStore instances on the same path', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-shared-path-'));
      const logPath = path.join(tempDir, 'test-store.json');
      try {
        const store1 = new FileStore(logPath);
        const store2 = new FileStore(logPath);

        const savePromises = Array.from({ length: 20 }, (_, i) => {
          const targetStore = i % 2 === 0 ? store1 : store2;
          return targetStore.save(createFailedRequest(`shared-${i}`));
        });
        await Promise.all(savePromises);

        const logs1 = await store1.loadAll();
        const logs2 = await store2.loadAll();
        expect(logs1).toHaveLength(20);
        expect(logs2).toHaveLength(20);
        expect(await store1.count()).toBe(20);
        expect(await store2.count()).toBe(20);

        const savedIds = new Set(logs1.map((log) => log.id));
        for (let i = 0; i < 20; i++) {
          expect(savedIds.has(`shared-${i}`)).toBe(true);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should maintain strict ordering between clear() and queued saves', async () => {
      // Case 1: enqueue saves, then clear(), then another save(), await all -> only post-clear entry remains
      {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-clear-1-'));
        const logPath = path.join(tempDir, 'test-store.json');
        try {
          const fileStore = new FileStore(logPath);
          const p1 = fileStore.save(createFailedRequest('before-clear-1'));
          const p2 = fileStore.save(createFailedRequest('before-clear-2'));
          const pClear = fileStore.clear();
          const p3 = fileStore.save(createFailedRequest('after-clear'));

          await Promise.all([p1, p2, pClear, p3]);

          const logs = await fileStore.loadAll();
          expect(logs).toHaveLength(1);
          expect(logs[0].id).toBe('after-clear');
          expect(await fileStore.count()).toBe(1);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }

      // Case 2: saves then clear() (awaited in order) leaves an empty log
      {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-clear-2-'));
        const logPath = path.join(tempDir, 'test-store.json');
        try {
          const fileStore = new FileStore(logPath);
          const p1 = fileStore.save(createFailedRequest('target-1'));
          const p2 = fileStore.save(createFailedRequest('target-2'));
          const pClear = fileStore.clear();

          await Promise.all([p1, p2, pClear]);

          const logs = await fileStore.loadAll();
          expect(logs).toHaveLength(0);
          expect(await fileStore.count()).toBe(0);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it('should preserve remove() return values and final state under concurrent operations', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-remove-'));
      const logPath = path.join(tempDir, 'test-store.json');
      try {
        const fileStore = new FileStore(logPath);

        const p1 = fileStore.save(createFailedRequest('req-1'));
        const p2 = fileStore.save(createFailedRequest('req-2'));
        const pRemove1 = fileStore.remove('req-1');
        const pRemoveMissing = fileStore.remove('missing-id');
        const pRemove1Again = fileStore.remove('req-1');
        const p3 = fileStore.save(createFailedRequest('req-3'));

        const [, , res1, resMissing, res1Again] = await Promise.all([
          p1,
          p2,
          pRemove1,
          pRemoveMissing,
          pRemove1Again,
          p3,
        ]);

        expect(res1).toBe(true);
        expect(resMissing).toBe(false);
        expect(res1Again).toBe(false);

        const logs = await fileStore.loadAll();
        expect(logs).toHaveLength(2);
        expect(logs.map((l) => l.id)).toEqual(['req-2', 'req-3']);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should self-heal and allow subsequent saves when a save write throws', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-throw-'));
      const logPath = path.join(tempDir, 'test-store.json');
      try {
        const fileStore = new FileStore(logPath);
        const originalWriteFileSync = fs.writeFileSync.bind(fs);

        let thrown = false;
        const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
          if (!thrown) {
            thrown = true;
            throw new Error('Disk write error');
          }
          return originalWriteFileSync(...args);
        });

        try {
          const failSave = fileStore.save(createFailedRequest('fail-req'));
          const succeedSave1 = fileStore.save(createFailedRequest('succeed-req-1'));
          const succeedSave2 = fileStore.save(createFailedRequest('succeed-req-2'));

          await expect(failSave).resolves.toBeUndefined();
          await expect(succeedSave1).resolves.toBeUndefined();
          await expect(succeedSave2).resolves.toBeUndefined();

          const logs = await fileStore.loadAll();
          expect(logs).toHaveLength(2);
          expect(logs.map((l) => l.id)).toEqual(['succeed-req-1', 'succeed-req-2']);
        } finally {
          writeSpy.mockRestore();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should trigger rotation under the queue when maxFileSizeBytes is exceeded and remain usable', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-retry-rotation-'));
      const logPath = path.join(tempDir, 'test-store.json');
      const rotatedPath = path.join(tempDir, 'test-store.1.json');
      try {
        const fileStore = new FileStore(logPath, { maxFileSizeBytes: 100 });

        await fileStore.save(createFailedRequest('rot-1'));
        expect(fs.existsSync(rotatedPath)).toBe(false);

        await fileStore.save(createFailedRequest('rot-2'));
        expect(fs.existsSync(rotatedPath)).toBe(true);

        const rotatedLogs = JSON.parse(fs.readFileSync(rotatedPath, 'utf-8'));
        expect(rotatedLogs).toHaveLength(1);
        expect(rotatedLogs[0].id).toBe('rot-1');

        await fileStore.save(createFailedRequest('rot-3'));
        const currentLogs = await fileStore.loadAll();
        expect(currentLogs.length).toBeGreaterThanOrEqual(1);
        expect(await fileStore.count()).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

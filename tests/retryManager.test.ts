import { RetryManager } from '../src/retryManager';
import fs from 'fs';
import path from 'path';

const TEST_LOG_PATH = path.join(__dirname, 'retry-test.json');

describe('RetryManager', () => {
  let manager: RetryManager;
  let callCount: number;

  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
    manager = new RetryManager({ maxRetries: 3, delay: 50 }, TEST_LOG_PATH);
    callCount = 0;
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  it('should succeed on first attempt', async () => {
    const fn = async () => {
      callCount++;
      return 'success';
    };

    const result = await manager.execute(fn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Temporary failure');
      }
      return 'success';
    };

    const result = await manager.execute(fn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
  });

  it('should fail after max retries', async () => {
    const fn = async () => {
      callCount++;
      throw new Error('Persistent failure');
    };

    const result = await manager.execute(fn);

    expect(result.success).toBe(false);
    expect(result.error.message).toBe('Persistent failure');
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
  });

  it('should not retry non-retryable errors', async () => {
    const fn = async () => {
      callCount++;
      const error: any = new Error('Not found');
      error.response = { status: 404 };
      throw error;
    };

    const result = await manager.execute(fn);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  it('should call onRetry hook', async () => {
    const retryAttempts: number[] = [];
    const managerWithHook = new RetryManager(
      {
        maxRetries: 3,
        delay: 50,
        onRetry: (attempt) => retryAttempts.push(attempt),
      },
      TEST_LOG_PATH
    );

    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Retry me');
      }
      return 'success';
    };

    await managerWithHook.execute(fn);

    expect(retryAttempts).toEqual([1, 2]);
  });

  it('should track total duration', async () => {
    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('Retry');
      }
      return 'success';
    };

    const result = await manager.execute(fn);

    expect(result.success).toBe(true);
    expect(result.totalDuration).toBeGreaterThan(50);
  });

  it('should clear failed requests', async () => {
    const fn = async () => {
      throw new Error('Fail');
    };

    await manager.execute(fn);
    expect(await manager.getFailedRequestCount()).toBe(1);

    await manager.clearFailedRequests();
    expect(await manager.getFailedRequestCount()).toBe(0);
  });
});

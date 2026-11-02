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
        const error: any = new Error('Temporary failure');
        error.response = { status: 503 };
        throw error;
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
      const error: any = new Error('Persistent failure');
      error.response = { status: 503 };
      throw error;
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
        const error: any = new Error('Retry me');
        error.response = { status: 503 };
        throw error;
      }
      return 'success';
    };

    await managerWithHook.execute(fn);

    expect(retryAttempts).toEqual([1, 2]);
  });

  it('should track total duration', async () => {
    // Uses a larger delay (200ms) with a proportional threshold (150ms) rather
    // than asserting against the exact configured delay: real timers can fire
    // a hair before the requested delay elapses (sub-millisecond scheduling/
    // Date.now() rounding), which made a tight 50ms-vs-50ms assertion flaky.
    const timedManager = new RetryManager({ maxRetries: 3, delay: 200 }, TEST_LOG_PATH);

    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        const error: any = new Error('Retry');
        error.response = { status: 503 };
        throw error;
      }
      return 'success';
    };

    const result = await timedManager.execute(fn);

    expect(result.success).toBe(true);
    expect(result.totalDuration).toBeGreaterThanOrEqual(150);
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

  describe('idempotent config', () => {
    it('does not retry a POST by default, even on a retryable status', async () => {
      const fn = async () => {
        callCount++;
        const error: any = new Error('Server error');
        error.response = { status: 503 };
        error.config = { method: 'post' };
        throw error;
      };

      const result = await manager.execute(fn);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
    });

    it('retries a POST when idempotent: true is set', async () => {
      const idempotentManager = new RetryManager(
        { maxRetries: 3, delay: 50, idempotent: true },
        TEST_LOG_PATH
      );

      const fn = async () => {
        callCount++;
        if (callCount < 2) {
          const error: any = new Error('Server error');
          error.response = { status: 503 };
          error.config = { method: 'post' };
          throw error;
        }
        return 'success';
      };

      const result = await idempotentManager.execute(fn);

      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it('still retries GET/PUT/DELETE by default', async () => {
      const fn = async () => {
        callCount++;
        if (callCount < 2) {
          const error: any = new Error('Server error');
          error.response = { status: 503 };
          error.config = { method: 'get' };
          throw error;
        }
        return 'success';
      };

      const result = await manager.execute(fn);

      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });
  });

  describe('jitter config', () => {
    it('executes retries with jitter enabled', async () => {
      const jitterManager = new RetryManager(
        { maxRetries: 3, delay: 50, jitter: true },
        TEST_LOG_PATH
      );

      const fn = async () => {
        callCount++;
        if (callCount < 3) {
          const error: any = new Error('Server error');
          error.response = { status: 503 };
          throw error;
        }
        return 'success';
      };

      const result = await jitterManager.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(callCount).toBe(3);
    });
  });

  describe('circuitBreaker config', () => {
    it('does not affect calls when not configured', () => {
      expect(manager.getCircuitState()).toBeUndefined();
    });

    it('fails fast without calling fn once the circuit is open', async () => {
      const breakerManager = new RetryManager(
        { maxRetries: 1, delay: 0, circuitBreaker: { failureThreshold: 2 } },
        TEST_LOG_PATH
      );

      const fn = async () => {
        callCount++;
        throw new Error('Down');
      };

      await breakerManager.execute(fn);
      await breakerManager.execute(fn);
      expect(breakerManager.getCircuitState()).toBe('open');
      expect(callCount).toBe(2);

      const result = await breakerManager.execute(fn);

      expect(result.success).toBe(false);
      expect((result.error as any).circuitOpen).toBe(true);
      expect(callCount).toBe(2); // fn was not called a third time
    });

    it('allows a trial request after the cooldown and closes on success', async () => {
      const breakerManager = new RetryManager(
        { maxRetries: 1, delay: 0, circuitBreaker: { failureThreshold: 1, cooldownMs: 20 } },
        TEST_LOG_PATH
      );

      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Down');
        }
        return 'recovered';
      };

      await breakerManager.execute(fn);
      expect(breakerManager.getCircuitState()).toBe('open');

      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await breakerManager.execute(fn);

      expect(result.success).toBe(true);
      expect(breakerManager.getCircuitState()).toBe('closed');
    });
  });

  describe('signal config (AbortSignal)', () => {
    function retryableError(): any {
      const error: any = new Error('Server error');
      error.response = { status: 503 };
      return error;
    }

    it('returns an abort result with 0 attempts and no log entry when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const abortManager = new RetryManager(
        { maxRetries: 3, delay: 50, signal: controller.signal },
        TEST_LOG_PATH
      );

      const result = await abortManager.execute(fnNeverCalled);

      async function fnNeverCalled(): Promise<string> {
        callCount++;
        return 'should not run';
      }

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(0);
      expect(callCount).toBe(0);
      expect(result.error.name).toBe('AbortError');
      expect(result.error.message).toBe('Retry aborted');
      expect(await abortManager.getFailedRequestCount()).toBe(0);
    });

    it('checks abort before the circuit-breaker fail-fast check', async () => {
      const controller = new AbortController();
      const breakerManager = new RetryManager(
        {
          maxRetries: 1,
          delay: 0,
          signal: controller.signal,
          circuitBreaker: { failureThreshold: 1 },
        },
        TEST_LOG_PATH
      );

      await breakerManager.execute(async () => {
        throw new Error('Down');
      });
      expect(breakerManager.getCircuitState()).toBe('open');

      controller.abort();
      const result = await breakerManager.execute(async () => {
        callCount++;
        return 'should not run';
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(0);
      expect(callCount).toBe(0);
      expect(result.error.name).toBe('AbortError');
      expect((result.error as any).circuitOpen).toBeUndefined();
    });

    it('stops promptly when aborted during backoff, without logging or tripping the breaker', async () => {
      const controller = new AbortController();
      const onRetryCalls: number[] = [];
      const abortManager = new RetryManager(
        {
          maxRetries: 3,
          delay: 2000,
          signal: controller.signal,
          onRetry: (attempt) => onRetryCalls.push(attempt),
          circuitBreaker: { failureThreshold: 1 },
        },
        TEST_LOG_PATH
      );

      const fn = async () => {
        callCount++;
        throw retryableError();
      };

      setTimeout(() => controller.abort(), 100);
      const startedAt = Date.now();
      const result = await abortManager.execute(fn);
      const elapsed = Date.now() - startedAt;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
      expect(result.error.name).toBe('AbortError');
      expect(elapsed).toBeLessThan(1000);
      expect(onRetryCalls).toEqual([1]);
      expect(await abortManager.getFailedRequestCount()).toBe(0);
      expect(abortManager.getCircuitState()).toBe('closed');
    });

    it('returns the abort result with no log entry when aborted during an in-flight attempt', async () => {
      const controller = new AbortController();
      const abortManager = new RetryManager(
        { maxRetries: 3, delay: 50, signal: controller.signal },
        TEST_LOG_PATH
      );

      const result = await abortManager.execute(async () => {
        callCount++;
        controller.abort();
        throw new Error('boom');
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
      expect(result.error.name).toBe('AbortError');
      expect(result.error.message).toBe('Retry aborted');
      expect(await abortManager.getFailedRequestCount()).toBe(0);
    });

    it('preserves the underlying AbortError when fn rejects with one while aborted', async () => {
      const controller = new AbortController();
      const abortManager = new RetryManager(
        { maxRetries: 3, delay: 50, signal: controller.signal },
        TEST_LOG_PATH
      );
      const abortError = new DOMException('The operation was aborted', 'AbortError');

      const result = await abortManager.execute(async () => {
        controller.abort();
        throw abortError;
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(abortError);
      expect(await abortManager.getFailedRequestCount()).toBe(0);
    });

    it('preserves the underlying AbortError when abort lands during backoff', async () => {
      const controller = new AbortController();
      const abortManager = new RetryManager(
        {
          maxRetries: 3,
          delay: 2000,
          signal: controller.signal,
          shouldRetry: () => true,
        },
        TEST_LOG_PATH
      );
      const abortError = new DOMException('The operation was aborted', 'AbortError');

      setTimeout(() => controller.abort(), 50);
      const result = await abortManager.execute(async () => {
        callCount++;
        throw abortError;
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(abortError);
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
      expect(await abortManager.getFailedRequestCount()).toBe(0);
    });

    it('treats an AbortError-named error as a normal error when the signal is not aborted', async () => {
      const controller = new AbortController();
      const abortManager = new RetryManager(
        {
          maxRetries: 3,
          delay: 10,
          signal: controller.signal,
          shouldRetry: () => true,
        },
        TEST_LOG_PATH
      );

      const result = await abortManager.execute(async () => {
        callCount++;
        if (callCount < 2) {
          const error = new DOMException('aborted by transport', 'AbortError');
          throw error;
        }
        return 'recovered';
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('recovered');
      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it('retries normally when the signal is present but never aborted', async () => {
      const controller = new AbortController();
      const abortManager = new RetryManager(
        { maxRetries: 3, delay: 10, signal: controller.signal },
        TEST_LOG_PATH
      );

      const result = await abortManager.execute(async () => {
        callCount++;
        if (callCount < 2) {
          throw retryableError();
        }
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it('does not leak abort listeners and a fresh signal works on a new manager', async () => {
      const controller = new AbortController();
      const addSpy = jest.spyOn(controller.signal, 'addEventListener');
      const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');
      const abortManager = new RetryManager(
        { maxRetries: 3, delay: 2000, signal: controller.signal },
        TEST_LOG_PATH
      );

      setTimeout(() => controller.abort(), 50);
      const result = await abortManager.execute(async () => {
        throw retryableError();
      });

      expect(result.success).toBe(false);
      expect(result.error.name).toBe('AbortError');
      const addedListeners = addSpy.mock.calls.map((call) => call[1]);
      const removedListeners = removeSpy.mock.calls
        .filter((call) => call[0] === 'abort')
        .map((call) => call[1]);
      expect(addedListeners.length).toBeGreaterThan(0);
      expect(removedListeners).toEqual(addedListeners);
      addSpy.mockRestore();
      removeSpy.mockRestore();

      const freshController = new AbortController();
      const freshManager = new RetryManager(
        { maxRetries: 3, delay: 10, signal: freshController.signal },
        TEST_LOG_PATH
      );
      const freshResult = await freshManager.execute(async () => {
        callCount++;
        if (callCount < 2) {
          throw retryableError();
        }
        return 'fresh-ok';
      });

      expect(freshResult.success).toBe(true);
      expect(freshResult.data).toBe('fresh-ok');
    });
  });
});

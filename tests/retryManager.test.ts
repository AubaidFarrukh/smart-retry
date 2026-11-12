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

  it('should still make one attempt when maxRetries is 0 or negative', async () => {
    for (const maxRetries of [0, -1]) {
      const zeroManager = new RetryManager({ maxRetries, delay: 1 }, TEST_LOG_PATH);
      let calls = 0;

      const result = await zeroManager.execute(async () => {
        calls++;
        throw new Error('boom');
      });

      expect(calls).toBe(1);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.error.message).toBe('boom');
    }
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

  describe('per-call RetryConfig override', () => {
    const OVERRIDE_LOG_PATH = path.join(__dirname, 'retry-override-test.json');

    beforeEach(() => {
      if (fs.existsSync(OVERRIDE_LOG_PATH)) {
        fs.unlinkSync(OVERRIDE_LOG_PATH);
      }
    });

    afterEach(() => {
      if (fs.existsSync(OVERRIDE_LOG_PATH)) {
        fs.unlinkSync(OVERRIDE_LOG_PATH);
      }
    });

    it('changes the attempt count for that call only and plain call uses instance config again', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('503');
        error.response = { status: 503 };
        throw error;
      };

      const overrideResult = await mgr.execute(fn, { maxRetries: 1 });
      expect(overrideResult.success).toBe(false);
      expect(overrideResult.attempts).toBe(1);
      expect(count).toBe(1);

      count = 0;
      const plainResult = await mgr.execute(fn);
      expect(plainResult.success).toBe(false);
      expect(plainResult.attempts).toBe(3);
      expect(count).toBe(3);
    });

    it('never mutates instance config across subsequent plain or override calls', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('503');
        error.response = { status: 503 };
        throw error;
      };

      const firstOverride = await mgr.execute(fn, { maxRetries: 5 });
      expect(firstOverride.attempts).toBe(5);
      expect(count).toBe(5);

      count = 0;
      const plainResult = await mgr.execute(fn);
      expect(plainResult.attempts).toBe(3);
      expect(count).toBe(3);

      count = 0;
      const secondOverride = await mgr.execute(fn, { delay: 0 });
      expect(secondOverride.attempts).toBe(3);
      expect(count).toBe(3);
    });

    it('recomputes predicate for idempotent override without shouldRetry for that call only', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('POST failure');
        error.response = { status: 503 };
        error.config = { method: 'post' };
        throw error;
      };

      const initialPlain = await mgr.execute(fn);
      expect(initialPlain.success).toBe(false);
      expect(initialPlain.attempts).toBe(1);
      expect(count).toBe(1);

      count = 0;
      const overrideResult = await mgr.execute(fn, { idempotent: true });
      expect(overrideResult.success).toBe(false);
      expect(overrideResult.attempts).toBe(3);
      expect(count).toBe(3);

      count = 0;
      const subsequentPlain = await mgr.execute(fn);
      expect(subsequentPlain.success).toBe(false);
      expect(subsequentPlain.attempts).toBe(1);
      expect(count).toBe(1);
    });

    it('honors idempotent: false override on an idempotent: true instance', async () => {
      const mgr = new RetryManager(
        { maxRetries: 3, delay: 0, idempotent: true },
        OVERRIDE_LOG_PATH
      );
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('POST failure');
        error.response = { status: 503 };
        error.config = { method: 'post' };
        throw error;
      };

      const plainResult = await mgr.execute(fn);
      expect(plainResult.attempts).toBe(3);
      expect(count).toBe(3);

      count = 0;
      const overrideResult = await mgr.execute(fn, { idempotent: false });
      expect(overrideResult.attempts).toBe(1);
      expect(count).toBe(1);
    });

    it('honors shouldRetry override for that call only', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('404 Not Found');
        error.response = { status: 404 };
        throw error;
      };

      const overrideResult = await mgr.execute(fn, {
        shouldRetry: (err: any) => err.response?.status === 404,
      });
      expect(overrideResult.attempts).toBe(3);
      expect(count).toBe(3);

      count = 0;
      const plainResult = await mgr.execute(fn);
      expect(plainResult.attempts).toBe(1);
      expect(count).toBe(1);
    });

    it('treats shouldRetry: undefined as no override', async () => {
      const defaultMgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      const notFoundFn = async () => {
        const error: any = new Error('404');
        error.response = { status: 404 };
        throw error;
      };

      const defaultResult = await defaultMgr.execute(notFoundFn, { shouldRetry: undefined });
      expect(defaultResult.attempts).toBe(1);

      const customMgr = new RetryManager(
        {
          maxRetries: 3,
          delay: 0,
          shouldRetry: (err: any) => err.response?.status === 404,
        },
        OVERRIDE_LOG_PATH
      );

      const customResult = await customMgr.execute(notFoundFn, { shouldRetry: undefined });
      expect(customResult.attempts).toBe(3);
    });

    it('clamps maxRetries: 0 and negative maxRetries to exactly one attempt without throwing', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('Failure');
        error.response = { status: 503 };
        throw error;
      };

      const zeroResult = await mgr.execute(fn, { maxRetries: 0 });
      expect(zeroResult.success).toBe(false);
      expect(zeroResult.attempts).toBe(1);
      expect(count).toBe(1);
      expect(await mgr.getFailedRequestCount()).toBe(1);

      await mgr.clearFailedRequests();
      count = 0;

      const negativeResult = await mgr.execute(fn, { maxRetries: -2 });
      expect(negativeResult.success).toBe(false);
      expect(negativeResult.attempts).toBe(1);
      expect(count).toBe(1);
      expect(await mgr.getFailedRequestCount()).toBe(1);

      // Also verify instance-level maxRetries: 0 clamp
      const zeroInstanceMgr = new RetryManager({ maxRetries: 0, delay: 0 }, OVERRIDE_LOG_PATH);
      count = 0;
      const instanceResult = await zeroInstanceMgr.execute(fn);
      expect(instanceResult.success).toBe(false);
      expect(instanceResult.attempts).toBe(1);
      expect(count).toBe(1);
    });

    it('fires per-call onRetry only for that call without calling instance hook', async () => {
      const instanceOnRetry = jest.fn();
      const overrideOnRetry = jest.fn();
      const mgr = new RetryManager(
        { maxRetries: 3, delay: 0, onRetry: instanceOnRetry },
        OVERRIDE_LOG_PATH
      );

      let count = 0;
      const fn = async () => {
        count++;
        if (count < 3) {
          const error: any = new Error('Retry me');
          error.response = { status: 503 };
          throw error;
        }
        return 'success';
      };

      const overrideResult = await mgr.execute(fn, { onRetry: overrideOnRetry });
      expect(overrideResult.success).toBe(true);
      expect(overrideOnRetry).toHaveBeenCalledTimes(2);
      expect(instanceOnRetry).toHaveBeenCalledTimes(0);

      count = 0;
      const plainResult = await mgr.execute(fn);
      expect(plainResult.success).toBe(true);
      expect(instanceOnRetry).toHaveBeenCalledTimes(2);
      expect(overrideOnRetry).toHaveBeenCalledTimes(2);
    });

    it('ignores per-call circuitBreaker config without affecting manager breaker state or crashing', async () => {
      // Manager with breaker
      const breakerMgr = new RetryManager(
        { maxRetries: 1, delay: 0, circuitBreaker: { failureThreshold: 2 } },
        OVERRIDE_LOG_PATH
      );
      const failFn = async () => {
        throw new Error('Down');
      };

      await breakerMgr.execute(failFn, { circuitBreaker: { failureThreshold: 10 } });
      await breakerMgr.execute(failFn, { circuitBreaker: { failureThreshold: 10 } });
      expect(breakerMgr.getCircuitState()).toBe('open');

      const fastFailResult = await breakerMgr.execute(failFn);
      expect(fastFailResult.success).toBe(false);
      expect((fastFailResult.error as any).circuitOpen).toBe(true);

      // Manager without breaker
      const noBreakerMgr = new RetryManager({ maxRetries: 1, delay: 0 }, OVERRIDE_LOG_PATH);
      await noBreakerMgr.execute(failFn, { circuitBreaker: { failureThreshold: 1 } });
      expect(noBreakerMgr.getCircuitState()).toBeUndefined();
    });

    it('behaves exactly like a plain call when an empty override {} is passed', async () => {
      const mgr = new RetryManager({ maxRetries: 3, delay: 0 }, OVERRIDE_LOG_PATH);
      let count = 0;
      const fn = async () => {
        count++;
        const error: any = new Error('503');
        error.response = { status: 503 };
        throw error;
      };

      const result = await mgr.execute(fn, {});
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(count).toBe(3);
    });
  });
});

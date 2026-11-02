/** @format */
import {
  RetryConfig,
  RetryResult,
  RetryableFunction,
  FailedRequest,
  FileStoreConfig,
  FailureStore,
} from './types';
import { FileStore } from './fileStore';
import { CircuitBreaker, CircuitState } from './circuitBreaker';
import {
  generateId,
  calculateDelay,
  defaultShouldRetry,
  sleep,
  getErrorMessage,
  getStatusCode,
  parseRetryAfter,
} from './utils';

function isFailureStore(store: unknown): store is FailureStore {
  if (typeof store !== 'object' || store === null) {
    return false;
  }
  const candidate = store as Record<string, unknown>;
  return (
    typeof candidate.save === 'function' &&
    typeof candidate.loadAll === 'function' &&
    typeof candidate.findById === 'function' &&
    typeof candidate.remove === 'function' &&
    typeof candidate.clear === 'function' &&
    typeof candidate.count === 'function'
  );
}

export class RetryManager {
  private config: Required<RetryConfig>;
  private store: FailureStore;
  private circuitBreaker?: CircuitBreaker;

  /**
   * Creates a new RetryManager instance.
   *
   * @param config - Optional retry configuration.
   * @param storeOrPath - Optional custom FailureStore instance, or a file path
   *   for the default FileStore.
   * @param storeConfig - Optional file store configuration. FileStore-only:
   *   must not be provided with a custom FailureStore.
   */
  constructor(
    config: RetryConfig = {},
    storeOrPath?: string | FailureStore,
    storeConfig?: FileStoreConfig
  ) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      delay: config.delay ?? 2000,
      backoff: config.backoff ?? 'exponential',
      shouldRetry: config.shouldRetry ?? ((error) => defaultShouldRetry(error, config.idempotent)),
      onRetry: config.onRetry ?? (() => {}),
      idempotent: config.idempotent ?? false,
      jitter: config.jitter ?? false,
      circuitBreaker: config.circuitBreaker ?? {},
    };

    if (typeof storeOrPath === 'string' || storeOrPath === undefined) {
      this.store = new FileStore(storeOrPath, storeConfig);
    } else if (isFailureStore(storeOrPath)) {
      if (storeConfig !== undefined) {
        throw new Error(
          'storeConfig is FileStore-only and cannot be used with a custom FailureStore'
        );
      }
      this.store = storeOrPath;
    } else {
      throw new TypeError('Expected a string file path or a FailureStore instance');
    }

    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }
  }

  async execute<T>(fn: RetryableFunction<T>): Promise<RetryResult<T>> {
    if (this.circuitBreaker && !this.circuitBreaker.canAttempt()) {
      const error = new Error(
        'Circuit breaker is open — too many consecutive failures, failing fast'
      );
      (error as any).circuitOpen = true;

      return {
        success: false,
        error,
        attempts: 0,
        totalDuration: 0,
      };
    }

    const startTime = Date.now();
    let lastError: any;
    let attempts = 0;

    while (attempts < this.config.maxRetries) {
      attempts++;

      try {
        const data = await fn();
        const totalDuration = Date.now() - startTime;

        this.circuitBreaker?.recordSuccess();

        return {
          success: true,
          data,
          attempts,
          totalDuration,
        };
      } catch (error) {
        lastError = error;

        if (!this.config.shouldRetry(error)) {
          break;
        }

        if (attempts < this.config.maxRetries) {
          const retryAfter = (error as any).response?.headers?.get?.('retry-after');
          const retryAfterDelay = parseRetryAfter(retryAfter);

          const delay =
            retryAfterDelay ??
            calculateDelay(this.config.delay, attempts, this.config.backoff, this.config.jitter);
          this.config.onRetry(attempts, error);
          await sleep(delay);
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    this.circuitBreaker?.recordFailure();
    await this.logFailure(fn, lastError, attempts, totalDuration);

    return {
      success: false,
      error: lastError,
      attempts,
      totalDuration,
    };
  }

  getCircuitState(): CircuitState | undefined {
    return this.circuitBreaker?.getState();
  }

  private async logFailure(
    fn: RetryableFunction<any>,
    error: any,
    attempts: number,
    totalDuration: number
  ): Promise<void> {
    const failedRequest: FailedRequest = {
      id: generateId(),
      url: this.extractUrl(fn, error),
      method: this.extractMethod(error),
      headers: error.config?.headers,
      body: error.config?.data,
      error: getErrorMessage(error),
      statusCode: getStatusCode(error),
      attempts,
      totalDuration,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.store.save(failedRequest);
    } catch {
      // best-effort logging; ignore write failures
    }
  }

  private extractUrl(fn: RetryableFunction<any>, error: any): string {
    if (error.config?.url) {
      return error.config.url;
    }
    if (error.request?.path) {
      return error.request.path;
    }
    return 'unknown';
  }

  private extractMethod(error: any): string {
    return error.config?.method?.toUpperCase() || 'GET';
  }

  async getFailedRequests(): Promise<FailedRequest[]> {
    return this.store.loadAll();
  }

  async getFailedRequest(id: string): Promise<FailedRequest | undefined> {
    return this.store.findById(id);
  }

  async clearFailedRequests(): Promise<void> {
    await this.store.clear();
  }

  async removeFailedRequest(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async getFailedRequestCount(): Promise<number> {
    return this.store.count();
  }

  /**
   * Returns the file path where failures are logged, or undefined if using
   * a non-file FailureStore.
   */
  getLogFilePath(): string | undefined {
    if (this.store instanceof FileStore) {
      return this.store.getFilePath();
    }
    return undefined;
  }
}

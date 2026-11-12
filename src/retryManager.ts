/** @format */
import {
  RetryConfig,
  RetryResult,
  RetryableFunction,
  FailedRequest,
  FileStoreConfig,
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

export class RetryManager {
  // Every RetryConfig field except `signal` has a default, so the resolved
  // config is Required except for the genuinely optional signal.
  private config: Omit<Required<RetryConfig>, 'signal'>;
  private signal?: AbortSignal;
  private store: FileStore;
  private circuitBreaker?: CircuitBreaker;

  constructor(config: RetryConfig = {}, storePath?: string, storeConfig?: FileStoreConfig) {
    this.config = {
      // Always make at least one attempt; 0 or negative values would otherwise
      // skip the loop entirely and crash while logging an undefined error.
      maxRetries: Math.max(1, config.maxRetries ?? 3),
      delay: config.delay ?? 2000,
      backoff: config.backoff ?? 'exponential',
      shouldRetry: config.shouldRetry ?? ((error) => defaultShouldRetry(error, config.idempotent)),
      onRetry: config.onRetry ?? (() => {}),
      idempotent: config.idempotent ?? false,
      jitter: config.jitter ?? false,
      circuitBreaker: config.circuitBreaker ?? {},
    };

    this.signal = config.signal;
    this.store = new FileStore(storePath, storeConfig);

    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }
  }

  async execute<T>(fn: RetryableFunction<T>): Promise<RetryResult<T>> {
    const startTime = Date.now();

    if (this.signal?.aborted) {
      return {
        success: false,
        error: this.createAbortError(),
        attempts: 0,
        totalDuration: 0,
      };
    }

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

    let lastError: any;
    let attempts = 0;

    while (attempts < this.config.maxRetries) {
      if (this.signal?.aborted) {
        return {
          success: false,
          error: this.createAbortError(),
          attempts,
          totalDuration: Date.now() - startTime,
        };
      }

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

        if (this.signal?.aborted) {
          const abortError =
            (error as any)?.name === 'AbortError' ? error : this.createAbortError();
          return {
            success: false,
            error: abortError,
            attempts,
            totalDuration: Date.now() - startTime,
          };
        }

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
          await this.abortableSleep(delay);

          if (this.signal?.aborted) {
            return {
              success: false,
              error:
                (lastError as any)?.name === 'AbortError' ? lastError : this.createAbortError(),
              attempts,
              totalDuration: Date.now() - startTime,
            };
          }
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

  private createAbortError(): Error {
    const error = new Error('Retry aborted');
    error.name = 'AbortError';
    return error;
  }

  private async abortableSleep(ms: number): Promise<void> {
    const signal = this.signal;
    if (!signal) {
      return sleep(ms);
    }
    if (signal.aborted) {
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    try {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        onAbort = () => resolve();
        signal.addEventListener('abort', onAbort);
        timer = setTimeout(resolve, ms);
      });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
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

    await this.store.save(failedRequest);
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

  getLogFilePath(): string {
    return this.store.getFilePath();
  }
}

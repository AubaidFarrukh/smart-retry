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

const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
];

export class RetryManager {
  private config: Required<RetryConfig>;
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
      redactHeaders: [...DEFAULT_REDACT_HEADERS, ...(config.redactHeaders ?? [])].map((name) =>
        name.toLowerCase()
      ),
      logBody: config.logBody ?? true,
      idempotent: config.idempotent ?? false,
      jitter: config.jitter ?? false,
      circuitBreaker: config.circuitBreaker ?? {},
    };

    this.store = new FileStore(storePath, storeConfig);

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
    const headers = error.config?.headers;
    // AxiosHeaders omits disabled headers in toJSON(); Fetch already supplies a plain object.
    const logHeaders: FailedRequest['headers'] =
      typeof headers?.toJSON === 'function' ? headers.toJSON() : headers;
    const failedRequest: FailedRequest = {
      id: generateId(),
      url: this.extractUrl(fn, error),
      method: this.extractMethod(error),
      headers: this.redactHeaders(logHeaders),
      body: this.config.logBody ? error.config?.data : undefined,
      error: getErrorMessage(error),
      statusCode: getStatusCode(error),
      attempts,
      totalDuration,
      timestamp: new Date().toISOString(),
    };

    await this.store.save(failedRequest);
  }

  private redactHeaders(headers: FailedRequest['headers']): FailedRequest['headers'] {
    if (!headers) return undefined;

    return Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name,
        this.config.redactHeaders.includes(name.toLowerCase()) ? '[REDACTED]' : value,
      ])
    );
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

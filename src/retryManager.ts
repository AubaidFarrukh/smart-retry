/** @format */
import { RetryConfig, RetryResult, RetryableFunction, FailedRequest } from "./types";
import { FileStore } from "./fileStore";
import {
  generateId,
  calculateDelay,
  defaultShouldRetry,
  sleep,
  getErrorMessage,
  getStatusCode,
} from "./utils";

export class RetryManager {
  private config: Required<RetryConfig>;
  private store: FileStore;

  constructor(config: RetryConfig = {}, storePath?: string) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      delay: config.delay ?? 2000,
      backoff: config.backoff ?? "exponential",
      shouldRetry: config.shouldRetry ?? defaultShouldRetry,
      onRetry: config.onRetry ?? (() => {}),
    };

    this.store = new FileStore(storePath);
  }

  async execute<T>(fn: RetryableFunction<T>): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let lastError: any;
    let attempts = 0;

    while (attempts < this.config.maxRetries) {
      attempts++;

      try {
        const data = await fn();
        const totalDuration = Date.now() - startTime;

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
          const delay = calculateDelay(this.config.delay, attempts, this.config.backoff);
          this.config.onRetry(attempts, error);
          await sleep(delay);
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    await this.logFailure(fn, lastError, attempts, totalDuration);

    return {
      success: false,
      error: lastError,
      attempts,
      totalDuration,
    };
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
    return "unknown";
  }

  private extractMethod(error: any): string {
    return error.config?.method?.toUpperCase() || "GET";
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

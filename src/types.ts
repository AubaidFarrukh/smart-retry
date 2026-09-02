/** @format */

export interface RetryConfig {
  maxRetries?: number;
  delay?: number;
  backoff?: 'exponential' | 'linear' | 'none';
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
  /**
   * By default, requests using a non-idempotent method (POST, PATCH) are not
   * retried, since the server may have already processed the request before
   * the response was lost. Set to `true` to retry them anyway (e.g. if your
   * endpoint is safe to call multiple times, such as via an idempotency key).
   */
  idempotent?: boolean;
  /**
   * Adds randomization to retry delay to prevent thundering-herd issues.
   * When enabled, delays are randomized between 50% and 100% of the computed backoff delay.
   * Default: false
   */
  jitter?: boolean;
}

export interface FailedRequest {
  id: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
  error: string;
  statusCode?: number;
  attempts: number;
  totalDuration: number;
  timestamp: string;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: any;
  attempts: number;
  totalDuration: number;
}

export interface FileStoreConfig {
  maxFileSizeBytes?: number;
  maxFiles?: number;
}

export type RetryableFunction<T> = () => Promise<T>;

/** @format */

import { CircuitBreakerConfig } from './circuitBreaker';

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
  /**
   * Trips the circuit open after too many consecutive failures, so calls
   * fail fast instead of retrying against a service that's fully down.
   * Off by default; pass an object (even `{}`) to enable with defaults.
   */
  circuitBreaker?: CircuitBreakerConfig;
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

export interface ReplayOptions {
  /**
   * Non-idempotent methods (POST, PATCH) are refused by default, since the
   * original request may have already been processed before it was logged
   * as failed — replaying it blindly can duplicate a side effect. Pass
   * `true` to replay anyway.
   */
  force?: boolean;
  /** Remove the entry from the failure log once replayed successfully. Default: true */
  removeOnSuccess?: boolean;
  /** Override the logged headers for this replay only. */
  headers?: Record<string, string>;
  /** Override the logged body for this replay only. */
  body?: any;
}

export interface ReplayAllOptions extends ReplayOptions {
  /** Only replay logged requests matching this method (e.g. "GET"). */
  method?: string;
  /** Only replay logged requests that failed with this status code. */
  statusCode?: number;
  /** Report what would be replayed without making any requests. */
  dryRun?: boolean;
}

export interface ReplayResult {
  id: string;
  url: string;
  method: string;
  success: boolean;
  skipped?: boolean;
  error?: any;
}

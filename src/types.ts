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

/**
 * Pluggable failure-log storage interface.
 *
 * Implementations persist and query failed HTTP requests that have exhausted
 * all retry attempts.
 *
 * Concurrency note: Implementations own their concurrency safety for concurrent
 * save() calls; read-modify-write stores must serialize internally.
 */
export interface FailureStore {
  /**
   * Persists a failed request that has exhausted all retries.
   *
   * @param request - The failed request details to log.
   * @returns A promise that resolves when the request has been saved.
   */
  save(request: FailedRequest): Promise<void>;

  /**
   * Loads all failed requests currently held in the store.
   *
   * @returns A promise that resolves with an array of all failed requests.
   */
  loadAll(): Promise<FailedRequest[]>;

  /**
   * Finds a specific failed request by its unique identifier.
   *
   * @param id - The ID of the failed request to find.
   * @returns A promise that resolves with the failed request, or undefined if not found.
   */
  findById(id: string): Promise<FailedRequest | undefined>;

  /**
   * Removes a failed request by its unique identifier.
   *
   * @param id - The ID of the failed request to remove.
   * @returns A promise that resolves with true if the entry was removed, or false if not found.
   */
  remove(id: string): Promise<boolean>;

  /**
   * Removes all failed requests from the store.
   *
   * @returns A promise that resolves when the store has been cleared.
   */
  clear(): Promise<void>;

  /**
   * Returns the total count of failed requests currently held in the store.
   *
   * @returns A promise that resolves with the count of stored failed requests.
   */
  count(): Promise<number>;
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

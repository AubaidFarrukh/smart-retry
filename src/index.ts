/** @format */

export { RetryManager } from './retryManager';
export { FileStore } from './fileStore';
export * from './types';
export * from './utils';
export * from './integrations';
export * from './circuitBreaker';

import { RetryManager } from './retryManager';
import {
  RetryConfig,
  RetryableFunction,
  RetryResult,
  FileStoreConfig,
  FailureStore,
} from './types';

export function smartRetry<T>(
  fn: RetryableFunction<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const manager = new RetryManager(config);
  return manager.execute(fn);
}

/**
 * Creates a new RetryManager instance with an optional custom FailureStore or file log path.
 *
 * @param config - Optional retry configuration.
 * @param storeOrPath - Optional custom FailureStore instance or file path for the default FileStore.
 * @param storeConfig - Optional file store configuration (only supported for FileStore).
 * @returns A new RetryManager instance.
 */
export function createRetryManager(
  config?: RetryConfig,
  storeOrPath?: string | FailureStore,
  storeConfig?: FileStoreConfig
): RetryManager {
  return new RetryManager(config, storeOrPath, storeConfig);
}

export default {
  RetryManager,
  smartRetry,
  createRetryManager,
};
// test comment

/** @format */

export { RetryManager } from './retryManager';
export { FileStore } from './fileStore';
export * from './types';
export * from './utils';
export * from './integrations';

import { RetryManager } from './retryManager';
import { RetryConfig, RetryableFunction, RetryResult,FileStoreConfig } from './types';

export function smartRetry<T>(
  fn: RetryableFunction<T>,
  config?: RetryConfig
): Promise<RetryResult<T>> {
  const manager = new RetryManager(config);
  return manager.execute(fn);
}

export function createRetryManager(config?: RetryConfig, storePath?: string, storeConfig?: FileStoreConfig): RetryManager {
  return new RetryManager(config, storePath, storeConfig);
}

export default {
  RetryManager,
  smartRetry,
  createRetryManager,
};
// test comment

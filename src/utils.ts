/** @format */

import { randomUUID } from 'crypto';

export function generateId(): string {
  return randomUUID();
}

export function calculateDelay(
  baseDelay: number,
  attempt: number,
  backoff: 'exponential' | 'linear' | 'none'
): number {
  switch (backoff) {
    case 'exponential':
      return baseDelay * Math.pow(2, attempt - 1);
    case 'linear':
      return baseDelay * attempt;
    case 'none':
      return baseDelay;
    default:
      return baseDelay;
  }
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export function isIdempotentMethod(method?: string): boolean {
  if (!method) return true;
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

export function defaultShouldRetry(error: any, allowNonIdempotent = false): boolean {
  if (!error) return false;

  if (!allowNonIdempotent && !isIdempotentMethod(error.config?.method)) {
    return false;
  }

  if (
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET'
  ) {
    return true;
  }

  const status = error.response?.status;
  if (!status) return false;

  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorMessage(error: any): string {
  if (error.response?.statusText) {
    return error.response.statusText;
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

export function getStatusCode(error: any): number | undefined {
  return error.response?.status;
}

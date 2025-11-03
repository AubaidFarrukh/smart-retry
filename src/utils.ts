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

export function defaultShouldRetry(error: any): boolean {
  if (!error) return false;

  if (
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET'
  ) {
    return true;
  }

  const status = error.response?.status;
  if (!status) return true;

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

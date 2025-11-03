/** @format */

export interface RetryConfig {
  maxRetries?: number;
  delay?: number;
  backoff?: "exponential" | "linear" | "none";
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
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

export type RetryableFunction<T> = () => Promise<T>;

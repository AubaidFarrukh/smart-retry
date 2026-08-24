/** @format */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { RetryManager } from './retryManager';
import { RetryConfig } from './types';

export class AxiosRetry {
  private retryManager: RetryManager;

  constructor(config?: RetryConfig, storePath?: string) {
    this.retryManager = new RetryManager(config, storePath);
  }

  async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const result = await this.retryManager.execute<AxiosResponse<T>>(() => axios.request(config));

    if (!result.success) {
      throw result.error;
    }

    return result.data!;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }

  getRetryManager(): RetryManager {
    return this.retryManager;
  }
}

export function createAxiosRetry(config?: RetryConfig, storePath?: string): AxiosRetry {
  return new AxiosRetry(config, storePath);
}

function isJsonSerializableBody(body: any): boolean {
  if (body === null || body === undefined || typeof body !== 'object') {
    return false;
  }

  if (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return false;
  }

  return true;
}

function buildBodyInit(body: unknown, init?: RequestInit): RequestInit {
  if (!isJsonSerializableBody(body)) {
    return { ...init, body: body as BodyInit | null | undefined };
  }

  return {
    ...init,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  };
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export class FetchRetry {
  private retryManager: RetryManager;

  constructor(config?: RetryConfig, storePath?: string) {
    this.retryManager = new RetryManager(config, storePath);
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestConfig = {
      url: getRequestUrl(input),
      method: (init?.method || 'GET').toUpperCase(),
      headers: normalizeHeaders(init?.headers),
      data: init?.body,
    };

    const result = await this.retryManager.execute<Response>(async () => {
      try {
        const response = await fetch(input, init);

        if (!response.ok) {
          const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = {
            status: response.status,
            statusText: response.statusText,
          };
          throw error;
        }

        return response;
      } catch (error: any) {
        error.config = requestConfig;
        throw error;
      }
    });

    if (!result.success) {
      throw result.error;
    }

    return result.data!;
  }

  async get(url: string, init?: RequestInit): Promise<Response> {
    return this.fetch(url, { ...init, method: 'GET' });
  }

  async post(url: string, body?: any, init?: RequestInit): Promise<Response> {
    return this.fetch(url, { ...buildBodyInit(body, init), method: 'POST' });
  }

  async put(url: string, body?: any, init?: RequestInit): Promise<Response> {
    return this.fetch(url, { ...buildBodyInit(body, init), method: 'PUT' });
  }

  async delete(url: string, init?: RequestInit): Promise<Response> {
    return this.fetch(url, { ...init, method: 'DELETE' });
  }

  async patch(url: string, body?: any, init?: RequestInit): Promise<Response> {
    return this.fetch(url, { ...buildBodyInit(body, init), method: 'PATCH' });
  }

  getRetryManager(): RetryManager {
    return this.retryManager;
  }
}

export function createFetchRetry(config?: RetryConfig, storePath?: string): FetchRetry {
  return new FetchRetry(config, storePath);
}

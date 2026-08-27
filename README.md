<!-- @format -->

# smart-retry

**smart-retry** is a TypeScript retry library for HTTP requests in Node.js. It wraps any async function, Axios call, or Fetch call with exponential/linear backoff, retries only transient failures (timeouts, network errors, 5xx, 429), and automatically logs exhausted failures to disk so you can inspect or replay them later.

[![CI](https://github.com/AubaidFarrukh/smart-retry/actions/workflows/ci.yml/badge.svg)](https://github.com/AubaidFarrukh/smart-retry/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40aubaid%2Fsmart-retry.svg)](https://www.npmjs.com/package/@aubaid/smart-retry)
[![npm downloads](https://img.shields.io/npm/dm/%40aubaid%2Fsmart-retry.svg)](https://www.npmjs.com/package/@aubaid/smart-retry)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Contents

- [Why smart-retry](#why-smart-retry)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [How It Works](#how-it-works)
- [Backoff Strategies](#backoff-strategies)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)
- [Links](#links)

## Why smart-retry

Most retry libraries stop at "try again with backoff." smart-retry adds two things most others don't:

- **Drop-in Axios and Fetch clients** (`createAxiosRetry`, `createFetchRetry`) instead of only a generic wrapper function, so you don't have to hand-roll the integration.
- **Automatic failure logging** — requests that exhaust all retries are persisted to disk with their URL, method, headers, body, and error, so you can inspect or replay them after the fact instead of losing the failure the moment it's thrown.

Use it when you're calling flaky third-party APIs, internal services behind a load balancer that occasionally 5xxs, or any HTTP call where a transient blip shouldn't fail the whole operation.

## Features

- **Smart retry logic** with exponential, linear, or fixed backoff
- **Automatic failure logging** to disk for later replay
- **Selective retries** — only retry transient errors (5xx, timeouts, network issues)
- **Easy integration** with Axios and Fetch
- **TypeScript support** with full type definitions
- **Hooks and callbacks** for monitoring retry attempts
- **Replay CLI** (coming soon) to retry failed requests

## Installation

```bash
npm install @aubaid/smart-retry
```

## Quick Start

### Simple Function Retry

```typescript
import { smartRetry } from '@aubaid/smart-retry';

const result = await smartRetry(() => fetchDataFromAPI(), {
  maxRetries: 5,
  delay: 2000,
  backoff: 'exponential',
});

if (result.success) {
  console.log('Data:', result.data);
} else {
  console.error('Failed after retries:', result.error);
}
```

### Axios Integration

`axios` is an optional peer dependency — install it if you want to use `createAxiosRetry`:

```bash
npm install axios
```

```typescript
import { createAxiosRetry } from '@aubaid/smart-retry';

const axiosRetry = createAxiosRetry({
  maxRetries: 5,
  delay: 2000,
  backoff: 'exponential',
});

const response = await axiosRetry.get('https://api.example.com/users');
console.log(response.data);
```

### Fetch Integration

```typescript
import { createFetchRetry } from '@aubaid/smart-retry';

const fetchRetry = createFetchRetry({
  maxRetries: 3,
  delay: 1000,
});

const response = await fetchRetry.get('https://api.example.com/data');
const data = await response.json();
```

## API Reference

### `smartRetry(fn, config?)`

Retry any async function.

**Parameters:**

- `fn: () => Promise<T>` - Function to retry
- `config?: RetryConfig` - Optional configuration

**Returns:** `Promise<RetryResult<T>>`

### `createAxiosRetry(config?, storePath?)`

Create an Axios client with retry support.

**Methods:**

- `get(url, config?)`
- `post(url, data?, config?)`
- `put(url, data?, config?)`
- `delete(url, config?)`
- `patch(url, data?, config?)`

### `createFetchRetry(config?, storePath?)`

Create a Fetch client with retry support.

**Methods:**

- `fetch(input, init?)`
- `get(url, init?)`
- `post(url, body?, init?)`
- `put(url, body?, init?)`
- `delete(url, init?)`
- `patch(url, body?, init?)`

### Configuration Options

```typescript
interface RetryConfig {
  maxRetries?: number; // Default: 3
  delay?: number; // Default: 2000ms
  backoff?: 'exponential' | 'linear' | 'none'; // Default: 'exponential'
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}
```

## Advanced Usage

### Custom Retry Logic

```typescript
import { createAxiosRetry } from '@aubaid/smart-retry';

const axiosRetry = createAxiosRetry({
  maxRetries: 5,
  delay: 3000,
  backoff: 'exponential',
  shouldRetry: (error) => {
    const status = error.response?.status;
    return status === 429 || status >= 500;
  },
  onRetry: (attempt, error) => {
    console.log(`Retry ${attempt}: ${error.message}`);
  },
});
```

### Access Failed Requests

```typescript
const axiosRetry = createAxiosRetry();

try {
  await axiosRetry.get('https://flaky-api.com/data');
} catch (error) {
  const manager = axiosRetry.getRetryManager();
  const failed = await manager.getFailedRequests();

  console.log(`${failed.length} requests logged`);
  console.log('Log file:', manager.getLogFilePath());
}
```

### Manage Failure Log

```typescript
const manager = retry.getRetryManager();

const all = await manager.getFailedRequests();

const count = await manager.getFailedRequestCount();

await manager.clearFailedRequests();

const removed = await manager.removeFailedRequest('request-id');
```

## How It Works

1. **Executes your function** with automatic retry on failure
2. **Detects transient errors** (5xx, timeouts, network issues)
3. **Waits with backoff** before retrying (exponential by default)
4. **Logs failures** to `smart-retry-log.json` after all retries exhausted
5. **Returns result** with metadata (attempts, duration, success status)

## Backoff Strategies

**Exponential (default):**

```
Attempt 1: 2s
Attempt 2: 4s
Attempt 3: 8s
Attempt 4: 16s
```

**Linear:**

```
Attempt 1: 2s
Attempt 2: 4s
Attempt 3: 6s
Attempt 4: 8s
```

**None:**

```
All attempts: 2s fixed delay
```

## FAQ

**Does smart-retry work with both Axios and Fetch?**
Yes — `createAxiosRetry` wraps Axios, `createFetchRetry` wraps the native `fetch` API. Both share the same retry, backoff, and failure-logging behavior.

**Does it work in the browser or on edge runtimes (Vercel Edge, Cloudflare Workers)?**
The retry and backoff logic works anywhere. The failure-logging feature writes to disk via Node's `fs` module, which isn't available in browsers or most edge runtimes; in those environments it degrades to a no-op instead of throwing, so `createFetchRetry` still works for the request itself — you just won't get an on-disk failure log.

**Which errors get retried by default?**
Network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNRESET`), HTTP 408, 429, and 5xx responses. 4xx client errors (except 408/429) and errors without a recognizable network/HTTP signal are not retried by default — override this with the `shouldRetry` config option.

**Where does the failure log get written?**
To `smart-retry-log.json` in the current working directory by default, or to a custom path passed as the second argument to `createAxiosRetry`/`createFetchRetry`/`createRetryManager`.

**Is there a CLI to replay failed requests?**
Not yet — failed requests are logged with enough detail (URL, method, headers, body) to replay manually via `getFailedRequests()`. A replay CLI is planned.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, commit conventions, and PR process. Please also review the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT © Aubaid Farrukh

## Links

- [npm package](https://www.npmjs.com/package/@aubaid/smart-retry)
- [GitHub repository](https://github.com/AubaidFarrukh/smart-retry)
- [Report issues](https://github.com/AubaidFarrukh/smart-retry/issues)

<!-- @format -->

# 🔄 smart-retry

Intelligent retry mechanism with exponential backoff, automatic failure logging, and replay support for HTTP requests.

[![npm version](https://img.shields.io/npm/v/smart-retry.svg)](https://www.npmjs.com/package/smart-retry)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- 🔄 **Smart retry logic** with exponential, linear, or fixed backoff
- 📊 **Automatic failure logging** to disk for later replay
- 🎯 **Selective retries** — only retry transient errors (5xx, timeouts, network issues)
- 🔌 **Easy integration** with Axios and Fetch
- 📝 **TypeScript support** with full type definitions
- 🪝 **Hooks and callbacks** for monitoring retry attempts
- 🗂️ **Replay CLI** (coming soon) to retry failed requests

## 📦 Installation

```bash
npm install smart-retry
```

## 🚀 Quick Start

### Simple Function Retry

```typescript
import { smartRetry } from 'smart-retry';

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

```typescript
import { createAxiosRetry } from 'smart-retry';

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
import { createFetchRetry } from 'smart-retry';

const fetchRetry = createFetchRetry({
  maxRetries: 3,
  delay: 1000,
});

const response = await fetchRetry.get('https://api.example.com/data');
const data = await response.json();
```

## 📖 API Reference

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

## 🎯 Advanced Usage

### Custom Retry Logic

```typescript
import { createAxiosRetry } from 'smart-retry';

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

## 🔧 How It Works

1. **Executes your function** with automatic retry on failure
2. **Detects transient errors** (5xx, timeouts, network issues)
3. **Waits with backoff** before retrying (exponential by default)
4. **Logs failures** to `smart-retry-log.json` after all retries exhausted
5. **Returns result** with metadata (attempts, duration, success status)

## 📝 Backoff Strategies

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

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## 📄 License

MIT © Aubaid Farrukh

## 🔗 Links

- [npm package](https://www.npmjs.com/package/@aubaid/smart-retry)
- [GitHub repository](https://github.com/AubaidFarrukh/smart-retry)
- [Report issues](https://github.com/AubaidFarrukh/smart-retry/issues)

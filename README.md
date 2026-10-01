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
- [CLI](#cli)
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
- **Circuit breaker** to fail fast against a service that's fully down instead of retrying into it
- **Replay failed requests** programmatically or via the `smart-retry replay` CLI

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
  idempotent?: boolean; // Default: false — see "Which errors get retried by default?" below
  jitter?: boolean; // Default: false — adds randomization (50-100% of delay) to avoid thundering-herd retries
  circuitBreaker?: CircuitBreakerConfig; // Off by default — see "Circuit Breaker" below
}

interface CircuitBreakerConfig {
  failureThreshold?: number; // Default: 5
  cooldownMs?: number; // Default: 30000ms
  onOpen?: () => void; // Called the moment the circuit trips open
  onClose?: () => void; // Called the moment the circuit recovers to closed
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

### Replay Failed Requests

Failures are logged with everything needed to retry them later — so you don't have to just know something failed, you can actually re-fire it:

```typescript
const client = createAxiosRetry();

// Replay one logged failure by id, using the stored url/headers/body
const response = await client.replay('failed-request-id');

// Replay every logged failure at once
const results = await client.replayAll();
// [{ id, url, method, success: true }, { id, url, method, success: false, error }, ...]
```

Non-idempotent requests (POST, PATCH) are refused by default — the original request may have already been processed by the server before it was logged as failed, so blindly replaying it risks duplicating a side effect (a double charge, a duplicate order). Pass `force: true` once you've confirmed it's safe:

```typescript
await client.replay('failed-request-id', { force: true });

// replayAll supports the same options, plus filtering and a dry run:
await client.replayAll({
  method: 'GET',
  statusCode: 503,
  dryRun: true, // report what would be replayed without making any requests
});
```

A successfully replayed request is removed from the failure log by default (`removeOnSuccess: true`); a failed replay stays logged so it isn't lost.

### Circuit Breaker

Retrying with backoff is meant for transient blips — but if a service is fully down, retrying just keeps hammering it. Enabling a circuit breaker tracks consecutive failures and, once a threshold is hit, fails fast (no attempts made at all) for a cooldown period instead of retrying, then lets a single trial request through to check if the service has recovered:

```typescript
const client = createAxiosRetry({
  maxRetries: 3,
  circuitBreaker: {
    failureThreshold: 5, // open the circuit after 5 consecutive failures
    cooldownMs: 30000, // stay open for 30s before trying again
    onOpen: () => alertOnCall('downstream service looks down'),
    onClose: () => alertOnCall('downstream service recovered'),
  },
});

try {
  await client.get('https://flaky-api.com/data');
} catch (error) {
  if (error.circuitOpen) {
    // failed instantly, no request was actually attempted
  }
}

client.getRetryManager().getCircuitState(); // 'closed' | 'open' | 'half-open'
```

The circuit is scoped to the `RetryManager` instance (i.e. per client), not per URL — if a single client calls several different endpoints, failures across all of them count toward the same breaker. Create separate clients per endpoint if you need independent breakers.

## CLI

Installing smart-retry also installs a `smart-retry` CLI for inspecting and replaying a failure log from the command line — handy for replaying failures after a deploy or an incident, without writing a script:

```bash
# List logged failures
npx smart-retry replay list
npx smart-retry replay list --method POST --status 503
npx smart-retry replay list --json

# Replay one, by id
npx smart-retry replay <id>
npx smart-retry replay <id> --dry-run   # preview without making the request
npx smart-retry replay <id> --force     # required for a logged POST/PATCH

# Replay everything (optionally filtered)
npx smart-retry replay --all
npx smart-retry replay --all --method GET --status 503
```

By default it reads `smart-retry-log.json` in the current directory; pass `--log <path>` to point at a different file. The replay itself goes through the same retry/backoff machinery as the rest of the library — `--max-retries`, `--delay`, `--backoff`, and `--idempotent` configure that policy for the replay, same meaning as the matching `RetryConfig` options. Run `smart-retry replay --help` for the full list.

The CLI replays over `fetch`, so it requires Node 18 or later regardless of which client (`AxiosRetry` or `FetchRetry`) originally logged the failure — the retry/backoff/circuit-breaker library code itself still supports Node 14+.

## How It Works

1. **Executes your function** with automatic retry on failure
2. **Detects transient errors** (5xx, timeouts, network issues)
3. **Waits with backoff** before retrying (exponential by default)
4. **Logs failures** to `smart-retry-log.json` after all retries exhausted
5. **Returns result** with metadata (attempts, duration, success status)

## Backoff Strategies

The delays below are the base values before jitter is applied. With `jitter: true`, each delay is randomized to 50–100% of the corresponding backoff delay.

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

**Why isn't my POST/PATCH request retrying?**
By design. If a POST or PATCH fails after the server may have already processed it (a lost response, a mid-request network drop), blindly retrying can cause a duplicate side effect — a double charge, a duplicate order, and so on. GET, PUT, DELETE, HEAD, and OPTIONS are safe to retry and do so by default; POST and PATCH don't, unless you pass `idempotent: true` in `RetryConfig` (e.g. because your endpoint is safe to call more than once, such as via an idempotency key) or supply your own `shouldRetry`.

**Where does the failure log get written?**
To `smart-retry-log.json` in the current working directory by default, or to a custom path passed as the second argument to `createAxiosRetry`/`createFetchRetry`/`createRetryManager`.

**Is there a CLI to replay failed requests?**
Yes — see the [CLI](#cli) section above (`npx smart-retry replay`), or use `replay()`/`replayAll()` programmatically (see [Replay Failed Requests](#replay-failed-requests)).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, commit conventions, and PR process. Please also review the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT © Aubaid Farrukh

## Links

- [npm package](https://www.npmjs.com/package/@aubaid/smart-retry)
- [GitHub repository](https://github.com/AubaidFarrukh/smart-retry)
- [Report issues](https://github.com/AubaidFarrukh/smart-retry/issues)

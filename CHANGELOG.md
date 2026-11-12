# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-11-12

### Added

- `FetchRetry` honours the `Retry-After` header (seconds or HTTP date) on retryable
  responses, in place of the configured backoff delay.
  ([#70](https://github.com/AubaidFarrukh/smart-retry/pull/70), thanks @PrathamShenoy14)

### Fixed

- `FetchRetry` now retries network errors on Node.js. Node's built-in `fetch` reports
  connection failures as `TypeError('fetch failed')` with the error code on `cause`, so
  `ECONNREFUSED`, `ECONNRESET` and undici timeouts were previously never retried.
  ([#75](https://github.com/AubaidFarrukh/smart-retry/pull/75))
- `FetchRetry.fetch()` reads the method and headers from a `Request` object. A `POST`
  passed as a `Request` is no longer treated as `GET` (retried and logged as `GET`), and
  retrying a `Request` with a body no longer fails with "Request object has already been
  used". ([#75](https://github.com/AubaidFarrukh/smart-retry/pull/75))
- `maxRetries: 0` (or a negative value) no longer throws a `TypeError`. At least one
  attempt is always made. ([#75](https://github.com/AubaidFarrukh/smart-retry/pull/75))
- Axios timeouts (`ECONNABORTED`) are now retried by default.
  ([#50](https://github.com/AubaidFarrukh/smart-retry/pull/50), thanks @ghzhost)
- Concurrent failures no longer overwrite each other in the failure log. Writes to the
  same log file are now serialized.
  ([#71](https://github.com/AubaidFarrukh/smart-retry/pull/71), thanks @AdityaxDeore)

### Changed

- Updated dependencies to resolve `npm audit` findings.
  ([#62](https://github.com/AubaidFarrukh/smart-retry/pull/62))
- Files are checked out with LF line endings on every platform (`.gitattributes`).

## [1.3.0] - 2026-10-01

- Added `replay()` / `replayAll()` and the `smart-retry` CLI for replaying logged
  failures. For earlier releases, see the
  [commit history](https://github.com/AubaidFarrukh/smart-retry/commits/main).

[1.4.0]: https://github.com/AubaidFarrukh/smart-retry/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/AubaidFarrukh/smart-retry/compare/v1.2.0...v1.3.0

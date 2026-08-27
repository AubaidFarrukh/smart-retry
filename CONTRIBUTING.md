<!-- @format -->

# Contributing to smart-retry

Thanks for taking the time to contribute! This guide covers how to get set up, the conventions the codebase follows, and how to submit a change.

## Getting started

```bash
git clone https://github.com/AubaidFarrukh/smart-retry.git
cd smart-retry
npm install
```

This installs Husky git hooks (via the `prepare` script), which run linting and commit-message checks automatically.

## Development workflow

```bash
npm run dev            # tsc --watch
npm test                # run the test suite once
npm run test:watch      # run tests in watch mode
npm run test:coverage   # run tests with coverage report
npm run lint            # check for lint errors
npm run lint:fix        # auto-fix lint errors
npm run format           # format src/ and tests/ with Prettier
npm run format:check     # check formatting without writing
npm run build            # compile TypeScript to dist/
```

Before opening a pull request, make sure `npm run lint`, `npm run format:check`, `npm run build`, and `npm test` all pass — the same checks run in CI.

## Making changes

- Keep pull requests focused on a single change. Smaller, scoped PRs are easier to review and merge.
- Add or update tests for any behavior change. Tests live in `tests/` and mirror the structure of `src/`.
- Don't add unrelated formatting or refactoring changes to a bug-fix or feature PR — send those separately.
- Update `README.md` if you're changing public API behavior, adding config options, or introducing a new integration.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint on every commit (see `commitlint.config.js`). The allowed types are:

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Examples:

```
feat: add support for custom retry condition callback
fix: correct exponential backoff calculation on last attempt
docs: clarify FileStore rotation behavior in README
```

## Pull request process

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests, following the workflow above.
3. Open a PR against `main` with a clear description of what changed and why.
4. CI must pass (lint, format, build, tests across supported Node versions) before merge.
5. Be responsive to review feedback — small follow-up commits are fine, no need to force-push during review.

## Reporting bugs / requesting features

Open an issue at [github.com/AubaidFarrukh/smart-retry/issues](https://github.com/AubaidFarrukh/smart-retry/issues). For bugs, include a minimal reproduction, the Node.js version, and the package version. For feature requests, describe the use case, not just the desired API.

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

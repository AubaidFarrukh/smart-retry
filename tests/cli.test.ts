/** @format */

import fs from 'fs';
import path from 'path';
import { parseArgs, formatRequest, run } from '../src/cli';
import { FailedRequest } from '../src/types';

describe('parseArgs', () => {
  it('parses "replay list" with filters', () => {
    const args = parseArgs(['replay', 'list', '--method', 'get', '--status', '500', '--json']);
    expect(args.command).toBe('list');
    expect(args.method).toBe('GET');
    expect(args.status).toBe(500);
    expect(args.json).toBe(true);
  });

  it('parses "replay <id>"', () => {
    const args = parseArgs(['replay', 'abc123', '--force', '--dry-run']);
    expect(args.command).toBe('replay');
    expect(args.id).toBe('abc123');
    expect(args.force).toBe(true);
    expect(args.dryRun).toBe(true);
  });

  it('parses "replay --all" without an id', () => {
    const args = parseArgs(['replay', '--all', '--method', 'post']);
    expect(args.command).toBe('replay');
    expect(args.all).toBe(true);
    expect(args.id).toBeUndefined();
    expect(args.method).toBe('POST');
  });

  it('parses retry-policy overrides', () => {
    const args = parseArgs([
      'replay',
      '--all',
      '--max-retries',
      '5',
      '--delay',
      '1000',
      '--backoff',
      'linear',
      '--idempotent',
    ]);
    expect(args.maxRetries).toBe(5);
    expect(args.delay).toBe(1000);
    expect(args.backoff).toBe('linear');
    expect(args.idempotent).toBe(true);
  });

  it('flags --help and an unrecognized/empty command', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs([]).command).toBeUndefined();
  });
});

describe('formatRequest', () => {
  it('formats a logged failure into a readable line', () => {
    const request: FailedRequest = {
      id: 'abc123',
      url: 'https://example.com',
      method: 'GET',
      error: 'HTTP 500',
      statusCode: 500,
      attempts: 3,
      totalDuration: 1234,
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    expect(formatRequest(request)).toContain('abc123');
    expect(formatRequest(request)).toContain('GET');
    expect(formatRequest(request)).toContain('https://example.com');
    expect(formatRequest(request)).toContain('[500]');
  });

  it('shows a dash when there is no status code', () => {
    const request: FailedRequest = {
      id: 'abc123',
      url: 'https://example.com',
      method: 'GET',
      error: 'network error',
      attempts: 3,
      totalDuration: 1234,
      timestamp: '2026-01-01T00:00:00.000Z',
    };

    expect(formatRequest(request)).toContain('[-]');
  });
});

describe('run', () => {
  const LOG_PATH = path.join(__dirname, 'cli-test-log.json');
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    if (fs.existsSync(LOG_PATH)) {
      fs.unlinkSync(LOG_PATH);
    }
    lines = [];
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(LOG_PATH)) {
      fs.unlinkSync(LOG_PATH);
    }
  });

  async function seedAFailure(method = 'GET', url = 'https://example.com/a') {
    const { createFetchRetry } = await import('../src/index');
    const client = createFetchRetry({ maxRetries: 1 }, LOG_PATH);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(client.fetch(url, { method })).rejects.toThrow();
    const logged = await client.getRetryManager().getFailedRequests();
    return logged.find((r) => r.url === url)!;
  }

  it('prints usage with no command', async () => {
    const code = await run([], log);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Usage:');
  });

  it('lists failures from the given log file', async () => {
    await seedAFailure('GET', 'https://example.com/a');

    const code = await run(['replay', 'list', '--log', LOG_PATH], log);

    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('https://example.com/a'))).toBe(true);
  });

  it('reports no failed requests when the log is empty', async () => {
    const code = await run(['replay', 'list', '--log', LOG_PATH], log);
    expect(code).toBe(0);
    expect(lines).toEqual(['No failed requests logged.']);
  });

  it('replays a single request by id', async () => {
    const failure = await seedAFailure('GET', 'https://example.com/a');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const code = await run(['replay', failure.id, '--log', LOG_PATH], log);

    expect(code).toBe(0);
    expect(lines[0]).toContain('✓ replayed');
  });

  it('fails with a non-zero exit code for an unknown id', async () => {
    const code = await run(['replay', 'missing-id', '--log', LOG_PATH], log);
    expect(code).toBe(1);
    expect(lines[0]).toContain('✗');
  });

  it('refuses a non-idempotent replay without --force', async () => {
    const failure = await seedAFailure('POST', 'https://example.com/b');

    const code = await run(['replay', failure.id, '--log', LOG_PATH], log);

    expect(code).toBe(1);
    expect(lines[0]).toMatch(/force/);
  });

  it('replays a non-idempotent request with --force', async () => {
    const failure = await seedAFailure('POST', 'https://example.com/b');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const code = await run(['replay', failure.id, '--force', '--log', LOG_PATH], log);

    expect(code).toBe(0);
    expect(lines[0]).toContain('✓ replayed');
  });

  it('dry-run shows what would be replayed without making a request', async () => {
    const failure = await seedAFailure('GET', 'https://example.com/a');
    const callsBefore = fetchMock.mock.calls.length;

    const code = await run(['replay', failure.id, '--dry-run', '--log', LOG_PATH], log);

    expect(code).toBe(0);
    expect(lines[0]).toContain('[dry-run]');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('replays all matching failures with --all', async () => {
    await seedAFailure('GET', 'https://example.com/a');
    await seedAFailure('GET', 'https://example.com/b');
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const code = await run(['replay', '--all', '--log', LOG_PATH], log);

    expect(code).toBe(0);
    expect(lines.filter((l) => l.includes('✓ replayed'))).toHaveLength(2);
  });
});

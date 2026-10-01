#!/usr/bin/env node
/** @format */

import { createFetchRetry } from './index';
import { FailedRequest } from './types';

interface ParsedArgs {
  command?: 'list' | 'replay';
  id?: string;
  all: boolean;
  log?: string;
  method?: string;
  status?: number;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  maxRetries?: number;
  delay?: number;
  backoff?: 'exponential' | 'linear' | 'none';
  idempotent: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    all: false,
    force: false,
    dryRun: false,
    json: false,
    idempotent: false,
    help: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--log':
        args.log = argv[++i];
        break;
      case '--method':
        args.method = argv[++i]?.toUpperCase();
        break;
      case '--status':
        args.status = Number(argv[++i]);
        break;
      case '--force':
        args.force = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--all':
        args.all = true;
        break;
      case '--max-retries':
        args.maxRetries = Number(argv[++i]);
        break;
      case '--delay':
        args.delay = Number(argv[++i]);
        break;
      case '--backoff':
        args.backoff = argv[++i] as 'exponential' | 'linear' | 'none';
        break;
      case '--idempotent':
        args.idempotent = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        positional.push(arg);
    }
  }

  if (positional[0] === 'replay' && positional[1] === 'list') {
    args.command = 'list';
  } else if (positional[0] === 'replay') {
    args.command = 'replay';
    if (positional[1] && !positional[1].startsWith('-')) {
      args.id = positional[1];
    }
  }

  return args;
}

export function formatRequest(r: FailedRequest): string {
  const status = r.statusCode ?? '-';
  return `${r.id}  ${r.method.padEnd(6)} ${r.url}  [${status}]  ${r.attempts} attempt(s)  ${r.timestamp}`;
}

const USAGE = `Usage:
  smart-retry replay list [--log <path>] [--method <METHOD>] [--status <code>] [--json]
  smart-retry replay <id> [--log <path>] [--force] [--dry-run]
  smart-retry replay --all [--log <path>] [--force] [--dry-run] [--method <METHOD>] [--status <code>]

Options:
  --log <path>        Path to the failure log file (default: smart-retry-log.json in cwd)
  --method <METHOD>   Filter by HTTP method (list / --all)
  --status <code>     Filter by status code (list / --all)
  --force             Replay non-idempotent (POST/PATCH) requests
  --dry-run           Show what would be replayed without making requests
  --json              Output as JSON (list only)
  --max-retries <n>   Retry config used for the replay itself (default: 3)
  --delay <ms>        Retry config used for the replay itself (default: 2000)
  --backoff <type>    exponential | linear | none (default: exponential)
  --idempotent        Treat replayed POST/PATCH requests as idempotent for the retry policy
`;

export async function run(
  argv: string[],
  log: (line: string) => void = console.log
): Promise<number> {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    log(USAGE);
    return args.help || !args.command ? 0 : 1;
  }

  const client = createFetchRetry(
    {
      maxRetries: args.maxRetries ?? 3,
      delay: args.delay ?? 2000,
      backoff: args.backoff ?? 'exponential',
      idempotent: args.idempotent,
    },
    args.log
  );
  const manager = client.getRetryManager();

  if (args.command === 'list') {
    const all = await manager.getFailedRequests();
    const filtered = all.filter(
      (r) =>
        (!args.method || r.method === args.method) &&
        (args.status === undefined || r.statusCode === args.status)
    );

    if (args.json) {
      log(JSON.stringify(filtered, null, 2));
    } else if (filtered.length === 0) {
      log('No failed requests logged.');
    } else {
      filtered.forEach((r) => log(formatRequest(r)));
    }
    return 0;
  }

  // args.command === 'replay'
  if (args.all) {
    const results = await client.replayAll({
      force: args.force,
      dryRun: args.dryRun,
      method: args.method,
      statusCode: args.status,
    });

    if (results.length === 0) {
      log('No failed requests match the given filters.');
      return 0;
    }

    let failures = 0;
    for (const r of results) {
      if (r.skipped) {
        log(`[dry-run] would replay ${r.method} ${r.url} (${r.id})`);
      } else if (r.success) {
        log(`✓ replayed ${r.method} ${r.url} (${r.id})`);
      } else {
        failures++;
        log(`✗ failed ${r.method} ${r.url} (${r.id}): ${r.error?.message ?? r.error}`);
      }
    }
    return failures > 0 ? 1 : 0;
  }

  if (!args.id) {
    log(USAGE);
    return 1;
  }

  if (args.dryRun) {
    const failed = await manager.getFailedRequest(args.id);
    if (!failed) {
      log(`No failed request found with id "${args.id}"`);
      return 1;
    }
    log(`[dry-run] would replay ${formatRequest(failed)}`);
    return 0;
  }

  try {
    await client.replay(args.id, { force: args.force });
    log(`✓ replayed ${args.id}`);
    return 0;
  } catch (error: any) {
    log(`✗ ${error.message}`);
    return 1;
  }
}

/* istanbul ignore next -- exercised manually as a real CLI, not under test */
if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

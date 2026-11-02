/** @format */

import fs from 'fs';
import path from 'path';
import { FailedRequest, FileStoreConfig } from './types';

const writeQueues = new Map<string, Promise<void>>();
const noop = () => {};

export class FileStore {
  private filePath: string;
  private maxFileSizeBytes?: number;
  private maxFiles: number;

  constructor(filePath?: string, storeConfig?: FileStoreConfig) {
    this.filePath = filePath || path.join(process.cwd(), 'smart-retry-log.json');
    this.maxFileSizeBytes = storeConfig?.maxFileSizeBytes;
    this.maxFiles = storeConfig?.maxFiles ?? 5;
    this.ensureFileExists();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.filePath);
    const tail = writeQueues.get(key) ?? Promise.resolve();
    const run = tail.then(
      () => operation(),
      () => operation()
    );
    writeQueues.set(key, run.then(noop, noop));
    return run;
  }

  private ensureFileExists(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
      }
    } catch {
      // fs unavailable or read-only (browser, edge runtime, serverless FS); degrade to no-op.
    }
  }

  async save(request: FailedRequest): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.rotateIfNeeded();

        const logs = await this.loadAll();
        logs.push(request);
        fs.writeFileSync(this.filePath, JSON.stringify(logs, null, 2), 'utf-8');
      } catch {
        // best-effort logging; ignore write failures
      }
    });
  }

  private rotateIfNeeded(): void {
    if (!this.maxFileSizeBytes) return;

    try {
      const stats = fs.statSync(this.filePath);
      if (stats.size >= this.maxFileSizeBytes) {
        this.rotateFiles();
      }
    } catch {
      // File might not exist yet, ignore stat errors
    }
  }

  // Reads are intentionally unqueued: callers that await a write promise
  // observe a consistent state, and fs.readFileSync is synchronous.
  async loadAll(): Promise<FailedRequest[]> {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async findById(id: string): Promise<FailedRequest | undefined> {
    const logs = await this.loadAll();
    return logs.find((log) => log.id === id);
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const logs = await this.loadAll();
        const filtered = logs.filter((log) => log.id !== id);

        if (filtered.length === logs.length) {
          return false;
        }

        fs.writeFileSync(this.filePath, JSON.stringify(filtered, null, 2), 'utf-8');
        return true;
      } catch {
        return false;
      }
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
      } catch {
        // best-effort logging; ignore write failures
      }
    });
  }

  async count(): Promise<number> {
    const logs = await this.loadAll();
    return logs.length;
  }

  getFilePath(): string {
    return this.filePath;
  }

  private rotateFiles(): void {
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath, '.json');

    const oldestFile = path.join(dir, `${baseName}.${this.maxFiles}.json`);
    if (fs.existsSync(oldestFile)) {
      fs.unlinkSync(oldestFile);
    }

    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const current = path.join(dir, `${baseName}.${i}.json`);
      const next = path.join(dir, `${baseName}.${i + 1}.json`);
      if (fs.existsSync(current)) {
        fs.renameSync(current, next);
      }
    }

    const rotatedName = path.join(dir, `${baseName}.1.json`);
    fs.renameSync(this.filePath, rotatedName);

    this.ensureFileExists();
  }
}

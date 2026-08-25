/** @format */

import fs from 'fs';
import path from 'path';
import { FailedRequest } from './types';

export class FileStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'smart-retry-log.json');
    this.ensureFileExists();
  }

  private ensureFileExists(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
      }
    } catch {
      // fs is unavailable or read-only (browser, edge runtime, serverless FS).
      // Failure logging degrades to a no-op instead of crashing construction.
    }
  }

  async save(request: FailedRequest): Promise<void> {
    try {
      const logs = await this.loadAll();
      logs.push(request);
      fs.writeFileSync(this.filePath, JSON.stringify(logs, null, 2), 'utf-8');
    } catch {
      // best-effort logging; ignore write failures
    }
  }

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
  }

  async clear(): Promise<void> {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    } catch {
      // best-effort logging; ignore write failures
    }
  }

  async count(): Promise<number> {
    const logs = await this.loadAll();
    return logs.length;
  }

  getFilePath(): string {
    return this.filePath;
  }
}

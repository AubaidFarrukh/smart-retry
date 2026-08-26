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
    this.rotateIfNeeded();

    const logs = await this.loadAll();
    logs.push(request);
    fs.writeFileSync(this.filePath, JSON.stringify(logs, null, 2), 'utf-8');
  }

  private rotateIfNeeded(): void {
    if (!this.maxFileSizeBytes) return;

    try {
      const stats = fs.statSync(this.filePath);
      if (stats.size >= this.maxFileSizeBytes) {
        this.rotateFiles();
      }
    } catch (err) {
      // File might not exist yet, ignore stat errors
      console.log('Error checking file size for rotation:', err);
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

  private rotateFiles(): void {
    const dir = path.dirname(this.filePath);
    const baseName = path.basename(this.filePath, '.json');

    // 1. Delete the oldest file if it exceeds maxFiles
    const oldestFile = path.join(dir, `${baseName}.${this.maxFiles}.json`);
    if (fs.existsSync(oldestFile)) {
      fs.unlinkSync(oldestFile);
    }

    // 2. Shift existing rotated files (e.g., .4 -> .5, .3 -> .4)
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const current = path.join(dir, `${baseName}.${i}.json`);
      const next = path.join(dir, `${baseName}.${i + 1}.json`);
      if (fs.existsSync(current)) {
        fs.renameSync(current, next);
      }
    }

    // 3. Rename the current active log to .1
    const rotatedName = path.join(dir, `${baseName}.1.json`);
    fs.renameSync(this.filePath, rotatedName);

    // 4. Create a fresh, empty active log
    this.ensureFileExists();
  }
}

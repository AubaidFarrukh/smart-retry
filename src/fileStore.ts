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
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  async save(request: FailedRequest): Promise<void> {
    const logs = await this.loadAll();
    logs.push(request);
    fs.writeFileSync(this.filePath, JSON.stringify(logs, null, 2), 'utf-8');
  }

  async loadAll(): Promise<FailedRequest[]> {
    const content = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(content);
  }

  async findById(id: string): Promise<FailedRequest | undefined> {
    const logs = await this.loadAll();
    return logs.find((log) => log.id === id);
  }

  async remove(id: string): Promise<boolean> {
    const logs = await this.loadAll();
    const filtered = logs.filter((log) => log.id !== id);

    if (filtered.length === logs.length) {
      return false;
    }

    fs.writeFileSync(this.filePath, JSON.stringify(filtered, null, 2), 'utf-8');
    return true;
  }

  async clear(): Promise<void> {
    fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
  }

  async count(): Promise<number> {
    const logs = await this.loadAll();
    return logs.length;
  }

  getFilePath(): string {
    return this.filePath;
  }
}

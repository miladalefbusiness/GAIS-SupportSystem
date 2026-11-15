import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { resolveStorageRoot } from '../config/env.ts';
import type { StorageDriver, StorageHealthResult, StoragePutResult } from './types.ts';

const SAFE_KEY_REGEX = /^[a-zA-Z0-9/_.-]+$/;

export class LocalDiskStorageDriver implements StorageDriver {
  readonly driverName = 'local' as const;
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = path.resolve(rootDir ?? resolveStorageRoot());
  }

  public resolveSafePath(storageKey: string): string {
    if (
      !storageKey ||
      storageKey.startsWith('/') ||
      !SAFE_KEY_REGEX.test(storageKey) ||
      storageKey.includes('..')
    ) {
      throw new Error('Invalid storage key rejected.');
    }
    const target = path.resolve(this.rootDir, storageKey);
    const rootWithSep = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;

    if (target !== this.rootDir && !target.startsWith(rootWithSep)) {
      throw new Error('Path traversal attempt rejected.');
    }
    return target;
  }

  async put(storageKey: string, data: Buffer): Promise<StoragePutResult> {
    const filePath = this.resolveSafePath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data, { flag: 'wx' });
    return { storageKey, byteSize: data.byteLength };
  }

  async getStream(storageKey: string): Promise<Readable> {
    const filePath = this.resolveSafePath(storageKey);
    await fs.access(filePath);
    return createReadStream(filePath);
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(storageKey);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.resolveSafePath(storageKey);
    await fs.rm(filePath, { force: true });
  }

  async healthCheck(): Promise<StorageHealthResult> {
    try {
      await fs.mkdir(this.rootDir, { recursive: true });
      const probePath = path.join(this.rootDir, '.health-probe');
      await fs.writeFile(probePath, 'ok', 'utf8');
      await fs.rm(probePath, { force: true });
      return {
        ok: true,
        driver: 'local',
        rootPath: this.rootDir,
        writable: true,
      };
    } catch (error) {
      return {
        ok: false,
        driver: 'local',
        rootPath: this.rootDir,
        writable: false,
        error: error instanceof Error ? error.message : 'Storage unavailable',
      };
    }
  }
}

let cachedDriver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!cachedDriver) {
    cachedDriver = new LocalDiskStorageDriver();
  }
  return cachedDriver;
}

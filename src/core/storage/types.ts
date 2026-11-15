import type { Readable } from 'node:stream';

export interface StoragePutResult {
  storageKey: string;
  byteSize: number;
}

export interface StorageHealthResult {
  ok: boolean;
  driver: 'local' | 's3';
  rootPath: string;
  writable: boolean;
  error?: string;
}

export interface StorageDriver {
  readonly driverName: 'local' | 's3';
  put(storageKey: string, data: Buffer): Promise<StoragePutResult>;
  getStream(storageKey: string): Promise<Readable>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
  healthCheck(): Promise<StorageHealthResult>;
}

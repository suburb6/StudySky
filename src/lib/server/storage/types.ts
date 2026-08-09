import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  byteSize: number;
  sha256: string;
}

export interface StorageObjectStat {
  key: string;
  byteSize: number;
  modifiedAt: Date;
}

export interface StorageProvider {
  put(key: string, source: ReadableStream<Uint8Array>, maximumBytes: number): Promise<StoredObject>;
  append(
    key: string,
    source: ReadableStream<Uint8Array>,
    expectedOffset: number,
    maximumBytes: number
  ): Promise<{ byteSize: number }>;
  open(key: string): Promise<Readable>;
  stat(key: string): Promise<StorageObjectStat>;
  move(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
}

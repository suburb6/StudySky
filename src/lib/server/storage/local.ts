import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as filesystem } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { StoredObject, StorageObjectStat, StorageProvider } from './types';

export class UploadTooLargeError extends Error {
  constructor(public readonly maximumBytes: number) {
    super(`Upload exceeds ${maximumBytes} bytes`);
  }
}

export class StorageOffsetError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number
  ) {
    super(`Expected offset ${expected}, found ${actual}`);
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly root: string;

  constructor(root = process.env.STORAGE_ROOT || path.resolve('data/uploads')) {
    this.root = path.resolve(root);
  }

  async put(
    key: string,
    source: ReadableStream<Uint8Array>,
    maximumBytes: number
  ): Promise<StoredObject> {
    const target = this.resolveKey(key);
    await filesystem.mkdir(path.dirname(target), { recursive: true });
    const digest = createHash('sha256');
    let byteSize = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > maximumBytes) {
          callback(new UploadTooLargeError(maximumBytes));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(
        Readable.fromWeb(source as unknown as NodeReadableStream<Uint8Array>),
        counter,
        createWriteStream(target, { flags: 'wx', mode: 0o600 })
      );
    } catch (error) {
      await filesystem.rm(target, { force: true });
      throw error;
    }

    return { key, byteSize, sha256: digest.digest('hex') };
  }

  async append(
    key: string,
    source: ReadableStream<Uint8Array>,
    expectedOffset: number,
    maximumBytes: number
  ): Promise<{ byteSize: number }> {
    const target = this.resolveKey(key);
    await filesystem.mkdir(path.dirname(target), { recursive: true });
    const current = await filesystem.stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const actual = current?.size ?? 0;
    if (actual !== expectedOffset) throw new StorageOffsetError(expectedOffset, actual);
    let byteSize = actual;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > maximumBytes) {
          callback(new UploadTooLargeError(maximumBytes));
          return;
        }
        callback(null, chunk);
      }
    });
    try {
      await pipeline(
        Readable.fromWeb(source as unknown as NodeReadableStream<Uint8Array>),
        counter,
        createWriteStream(target, { flags: 'a', mode: 0o600 })
      );
    } catch (error) {
      await filesystem.truncate(target, actual).catch(() => undefined);
      throw error;
    }
    return { byteSize };
  }

  async open(key: string) {
    return createReadStream(this.resolveKey(key));
  }

  async stat(key: string): Promise<StorageObjectStat> {
    const value = await filesystem.stat(this.resolveKey(key));
    return { key, byteSize: value.size, modifiedAt: value.mtime };
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.resolveKey(from);
    const target = this.resolveKey(to);
    await filesystem.mkdir(path.dirname(target), { recursive: true });
    await filesystem.rename(source, target);
  }

  async delete(key: string): Promise<void> {
    await filesystem.rm(this.resolveKey(key), { force: true });
  }

  resolveKey(key: string): string {
    if (
      !key ||
      key.includes('\\') ||
      key.includes('\u0000') ||
      path.posix.isAbsolute(key) ||
      key.split('/').some((part) => part === '..' || part === '')
    ) {
      throw new Error('Invalid storage key');
    }
    const target = path.resolve(this.root, ...key.split('/'));
    const prefix = `${this.root}${path.sep}`;
    if (!target.startsWith(prefix)) throw new Error('Storage key escapes root');
    return target;
  }
}

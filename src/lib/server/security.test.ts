import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './auth';
import { isPublicPushAddress, normalizePushEndpoint } from './push-security';
import { LocalStorageProvider } from './storage';

let temporaryDirectory: string | null = null;
const originalPushAllowlist = process.env.PUSH_ENDPOINT_ALLOWLIST;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
  if (originalPushAllowlist === undefined) delete process.env.PUSH_ENDPOINT_ALLOWLIST;
  else process.env.PUSH_ENDPOINT_ALLOWLIST = originalPushAllowlist;
});

describe('security primitives', () => {
  it('hashes passwords with Argon2id and verifies without exposing the password', async () => {
    const password = 'correct horse battery staple';
    const digest = await hashPassword(password);
    expect(digest).toMatch(/^\$argon2id\$/);
    expect(digest).not.toContain(password);
    await expect(verifyPassword(digest, password)).resolves.toBe(true);
    await expect(verifyPassword(digest, 'incorrect')).resolves.toBe(false);
  });

  it('rejects path traversal and stores uploads with private file permissions', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'studysky-storage-'));
    const storage = new LocalStorageProvider(temporaryDirectory);
    expect(() => storage.resolveKey('../secret')).toThrow('Invalid storage key');
    expect(() => storage.resolveKey('/absolute')).toThrow('Invalid storage key');
    const stored = await storage.put(
      'user/document/original.txt',
      new Blob(['private notes']).stream(),
      1_024
    );
    expect(stored.byteSize).toBe(13);
    await expect(readFile(storage.resolveKey(stored.key), 'utf8')).resolves.toBe('private notes');
  });

  it('restricts push endpoints to approved public HTTPS services', () => {
    expect(normalizePushEndpoint('https://fcm.googleapis.com/fcm/send/example')).toBe(
      'https://fcm.googleapis.com/fcm/send/example'
    );
    expect(() => normalizePushEndpoint('http://fcm.googleapis.com/fcm/send/example')).toThrow(
      'HTTPS'
    );
    expect(() => normalizePushEndpoint('https://127.0.0.1/push')).toThrow('approved host name');
    expect(() => normalizePushEndpoint('https://attacker.example/push')).toThrow('not approved');

    process.env.PUSH_ENDPOINT_ALLOWLIST = 'push.example.test';
    expect(normalizePushEndpoint('https://push.example.test/messages/1')).toBe(
      'https://push.example.test/messages/1'
    );
    expect(isPublicPushAddress('127.0.0.1')).toBe(false);
    expect(isPublicPushAddress('10.0.0.8')).toBe(false);
    expect(isPublicPushAddress('::1')).toBe(false);
    expect(isPublicPushAddress('8.8.8.8')).toBe(true);
    expect(isPublicPushAddress('2606:4700:4700::1111')).toBe(true);
  });
});

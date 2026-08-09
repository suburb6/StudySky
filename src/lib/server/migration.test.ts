import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('timezone default migration', () => {
  it('changes defaults only and contains no row rewrite', async () => {
    const migration = await readFile(
      path.resolve('drizzle/0005_timezone_defaults_utc.sql'),
      'utf8'
    );
    expect(migration).toContain('ALTER COLUMN "timezone" SET DEFAULT \'UTC\'');
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
  });
});

describe('session-bound push migration', () => {
  it('clears legacy unbound endpoints before adding the required session key', async () => {
    const migration = await readFile(path.resolve('drizzle/0006_big_firebird.sql'), 'utf8');
    const removeLegacy = migration.indexOf('DELETE FROM "push_subscriptions"');
    const addSession = migration.indexOf('ADD COLUMN "session_id" uuid NOT NULL');
    expect(removeLegacy).toBeGreaterThanOrEqual(0);
    expect(addSession).toBeGreaterThan(removeLegacy);
    expect(migration).toContain('ON DELETE cascade');
  });
});

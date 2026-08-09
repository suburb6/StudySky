import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('backup and restore scripts', () => {
  it('verifies database, files, and checksums before reporting success', async () => {
    const backup = await readFile(path.resolve('scripts/backup.sh'), 'utf8');
    expect(backup).toContain('pg_restore --list');
    expect(backup).toContain('tar --list');
    expect(backup).toContain('sha256sum');
    expect(backup.indexOf('mv -- "${partial}" "${destination}"')).toBeGreaterThan(
      backup.indexOf('sha256sum database.dump uploads.tar manifest.txt')
    );
  });

  it('requires an explicit destructive restore confirmation', async () => {
    const restore = await readFile(path.resolve('scripts/restore.sh'), 'utf8');
    expect(restore).toContain('CONFIRM_RESTORE');
    expect(restore).toContain('REPLACE_STUDYSKY_DATA');
    expect(restore.indexOf('sha256sum --check')).toBeLessThan(restore.indexOf('pg_restore \\\n'));
  });
});

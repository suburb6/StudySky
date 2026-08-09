import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase } from '../src/lib/server/db/index.ts';
import { users } from '../src/lib/server/db/schema.ts';
import { hashPassword, normalizeEmail } from '../src/lib/server/auth.ts';
import { defaultStorageQuotaBytes } from '../src/lib/server/config.ts';
import { canonicalTimeZone } from '../src/lib/domain/time.ts';

async function main() {
  const email = normalizeEmail(required('ADMIN_EMAIL'));
  const password = required('ADMIN_PASSWORD');
  const name = process.env.ADMIN_NAME?.trim() || 'StudySky owner';
  const timezoneValue = process.env.ADMIN_TIMEZONE?.trim() || 'UTC';
  const timezone = canonicalTimeZone(timezoneValue);
  if (!timezone) throw new Error('ADMIN_TIMEZONE must be a valid IANA timezone');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

  const db = getDatabase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    if (process.env.RESET_ADMIN_PASSWORD === 'true') {
      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(password),
          name,
          role: 'admin',
          timezone,
          updatedAt: new Date()
        })
        .where(eq(users.id, existing.id));
      console.log(`Updated administrator ${email}`);
    } else {
      console.log(`Administrator ${email} already exists; password and workspace left unchanged`);
    }
    return;
  }

  await db.insert(users).values({
    email,
    passwordHash: await hashPassword(password),
    name,
    role: 'admin',
    timezone,
    storageQuotaBytes: defaultStorageQuotaBytes()
  });
  console.log(`Created administrator ${email} with an empty workspace`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);

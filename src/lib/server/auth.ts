import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { getDatabase } from './db';
import { auditLogs, loginAttempts, sessions, users } from './db/schema';

export const SESSION_COOKIE = 'studysky_session';
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$VDAI3fenqicjRdj3hq5lSw$89w+A0VKEZXDZK41lPfUFhlI7+VxLD8mdFKLn02wPuw';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

export class LoginBlockedError extends Error {
  constructor(public readonly retryAt: Date) {
    super('Too many login attempts');
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function loginAttemptKey(email: string, clientAddress: string): string {
  return createHash('sha256')
    .update(`${normalizeEmail(email)}\u0000${clientAddress}`)
    .digest('hex');
}

export async function authenticate(
  email: string,
  password: string,
  clientAddress: string
): Promise<typeof users.$inferSelect | null> {
  const db = getDatabase();
  const normal = normalizeEmail(email);
  const key = loginAttemptKey(normal, clientAddress);

  return db.transaction(async (tx) => {
    // Serialize the whole check/verify/update sequence for this email and
    // address. Otherwise a parallel burst can pass the guard and collapse
    // many failed guesses into one read-modify-write counter increment.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const now = new Date();
    const [attempt] = await tx
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.key, key))
      .limit(1);
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      throw new LoginBlockedError(attempt.blockedUntil);
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normal}`)
      .limit(1);
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password
    );

    if (!user || !passwordMatches) {
      const windowExpired =
        !attempt || now.getTime() - attempt.windowStartedAt.getTime() > LOGIN_WINDOW_MS;
      const attempts = windowExpired ? 1 : attempt.attempts + 1;
      const blockedUntil =
        attempts >= MAX_LOGIN_ATTEMPTS ? new Date(now.getTime() + LOGIN_WINDOW_MS) : null;
      const windowStartedAt = windowExpired ? now : attempt.windowStartedAt;
      await tx
        .insert(loginAttempts)
        .values({ key, attempts, windowStartedAt, blockedUntil, updatedAt: now })
        .onConflictDoUpdate({
          target: loginAttempts.key,
          set: { attempts, windowStartedAt, blockedUntil, updatedAt: now }
        });
      return null;
    }

    await tx.delete(loginAttempts).where(eq(loginAttempts.key, key));
    return user;
  });
}

export async function createSession(
  userId: string,
  clientAddress: string,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const db = getDatabase();
  const token = randomBytes(32).toString('base64url');
  const configuredDays = Number(process.env.SESSION_DAYS ?? 30);
  const sessionDays = Number.isFinite(configuredDays)
    ? Math.min(Math.max(configuredDays, 1), 90)
    : 30;
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      userId,
      tokenHash: tokenDigest(token),
      ipAddress: clientAddress.slice(0, 64),
      userAgent: userAgent?.slice(0, 500),
      expiresAt
    });
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: 'session.created',
      entityType: 'session',
      ipAddress: clientAddress.slice(0, 64)
    });
  });

  return { token, expiresAt };
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt
  });
}

export async function resolveSession(token: string | undefined): Promise<{
  sessionId: string;
  user: NonNullable<App.Locals['user']>;
} | null> {
  if (!token) return null;

  const db = getDatabase();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      timezone: users.timezone
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenDigest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  return {
    sessionId: row.sessionId,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      timezone: row.timezone
    }
  };
}

export async function destroySession(
  sessionId: string | null,
  userId: string | null,
  clientAddress: string
): Promise<void> {
  if (!sessionId) return;
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.id, sessionId));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: 'session.destroyed',
      entityType: 'session',
      entityId: sessionId,
      ipAddress: clientAddress.slice(0, 64)
    });
  });
}

export async function removeExpiredSessions(): Promise<number> {
  const db = getDatabase();
  const removed = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} <= now()`)
    .returning({ id: sessions.id });
  return removed.length;
}

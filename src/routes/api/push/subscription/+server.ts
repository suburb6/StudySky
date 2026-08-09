import { error, json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';
import { normalizePushEndpoint } from '$lib/server/push-security';
import type { RequestHandler } from './$types';

const subscriptionSchema = z.object({
  endpoint: z.string().min(1).max(4_000),
  keys: z.object({
    p256dh: z.string().min(20).max(1_000),
    auth: z.string().min(5).max(1_000)
  })
});
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user || !locals.sessionId) error(401, 'Authentication required.');
  const userId = locals.user.id;
  const sessionId = locals.sessionId;
  const parsed = subscriptionSchema.safeParse(await request.json());
  if (!parsed.success) error(400, 'Invalid push subscription.');
  let endpoint: string;
  try {
    endpoint = normalizePushEndpoint(parsed.data.endpoint);
  } catch (caught) {
    error(400, caught instanceof Error ? caught.message : 'Invalid push endpoint.');
  }
  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [existing] = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);
    if (!existing) {
      const current = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .limit(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
      if (current.length >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
        error(429, 'Too many browser push subscriptions. Remove an old device first.');
      }
    }
    await tx
      .insert(pushSubscriptions)
      .values({
        userId,
        sessionId,
        endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          sessionId,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth
        }
      });
  });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.user || !locals.sessionId) error(401, 'Authentication required.');
  const parsed = z.object({ endpoint: z.url().max(4_000) }).safeParse(await request.json());
  if (!parsed.success) error(400, 'Invalid push subscription.');
  await getDatabase()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, locals.user.id),
        eq(pushSubscriptions.sessionId, locals.sessionId),
        eq(pushSubscriptions.endpoint, parsed.data.endpoint)
      )
    );
  return json({ ok: true });
};

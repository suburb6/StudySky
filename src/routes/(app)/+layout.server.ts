import { redirect } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(303, '/login');
  const [value] = await getDatabase()
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, locals.user.id), isNull(notifications.readAt)));
  return { user: locals.user, unreadNotifications: Number(value?.count ?? 0) };
};

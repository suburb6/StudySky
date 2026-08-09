import { fail } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';
import { formString } from '$lib/server/forms';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const rows = await getDatabase()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, locals.user!.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
  return {
    notifications: rows,
    unread: rows.filter((row) => !row.readAt).length,
    pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY)
  };
};

export const actions: Actions = {
  read: async ({ request, locals }) => {
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'notificationId'));
    if (!id.success) return fail(400, { error: 'Invalid notification.' });
    await getDatabase()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id.data), eq(notifications.userId, locals.user!.id)));
    return { success: true };
  },
  readAll: async ({ locals }) => {
    await getDatabase()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, locals.user!.id), isNull(notifications.readAt)));
    return { success: true };
  }
};

import { fail } from '@sveltejs/kit';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import { modules, timetableEntries } from '$lib/server/db/schema';
import { formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { listModules } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const moduleSchema = z.object({
  code: z
    .string()
    .min(1, 'Enter a module code.')
    .max(40)
    .transform((value) => value.toUpperCase()),
  name: z.string().min(2, 'Enter a module name.').max(180),
  lecturerName: z.string().max(180).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a valid colour.')
});

export const load: PageServerLoad = async ({ locals }) => ({
  modules: await listModules(locals.user!.id)
});

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = moduleSchema.safeParse({
      code: formString(form, 'code'),
      name: formString(form, 'name'),
      lecturerName: optionalFormString(form, 'lecturerName'),
      color: formString(form, 'color') || '#787774'
    });
    if (!parsed.success) return fail(400, { error: issueMessage(parsed.error), action: 'create' });

    try {
      const db = getDatabase();
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(modules)
          .values({
            userId: locals.user!.id,
            ...parsed.data
          })
          .returning({ id: modules.id });
        await tx
          .update(timetableEntries)
          .set({ moduleId: created.id, updatedAt: new Date() })
          .where(
            and(
              eq(timetableEntries.userId, locals.user!.id),
              eq(timetableEntries.kind, 'class'),
              isNull(timetableEntries.moduleId),
              or(
                sql`upper(split_part(${timetableEntries.title}, ' ', 1)) = ${parsed.data.code}`,
                sql`upper(left(${timetableEntries.title}, length(${parsed.data.name}))) = upper(${parsed.data.name})`
              )!
            )
          );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail(409, { error: 'That module code already exists.', action: 'create' });
      }
      throw error;
    }
    return { success: true, action: 'create' };
  }
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

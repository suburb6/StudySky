import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import { assessments, modules } from '$lib/server/db/schema';
import { formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { progressOverview } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const assessmentSchema = z
  .object({
    moduleId: z.uuid(),
    name: z.string().min(2, 'Enter an assessment name.').max(240),
    type: z.string().min(2, 'Enter an assessment type.').max(100),
    maximumMark: z.coerce.number().positive().max(1_000_000),
    achievedMark: z.coerce.number().min(0).nullable(),
    weight: z.coerce.number().min(0).max(100).nullable(),
    assessmentDate: z.iso.date(),
    targetMark: z.coerce.number().min(0).nullable(),
    notes: z.string().max(20_000).nullable()
  })
  .refine((value) => value.achievedMark === null || value.achievedMark <= value.maximumMark, {
    message: 'Achieved mark cannot exceed the maximum mark.'
  })
  .refine((value) => value.targetMark === null || value.targetMark <= value.maximumMark, {
    message: 'Target mark cannot exceed the maximum mark.'
  });

export const load: PageServerLoad = async ({ locals }) => ({
  overview: await progressOverview(locals.user!.id)
});

export const actions: Actions = {
  createAssessment: async ({ request, locals }) => {
    const form = await request.formData();
    const achieved = optionalFormString(form, 'achievedMark');
    const weight = optionalFormString(form, 'weight');
    const target = optionalFormString(form, 'targetMark');
    const parsed = assessmentSchema.safeParse({
      moduleId: formString(form, 'moduleId'),
      name: formString(form, 'name'),
      type: formString(form, 'type'),
      maximumMark: formString(form, 'maximumMark'),
      achievedMark: achieved,
      weight,
      assessmentDate: formString(form, 'assessmentDate'),
      targetMark: target,
      notes: optionalFormString(form, 'notes')
    });
    if (!parsed.success) {
      return fail(400, {
        action: 'createAssessment',
        error: issueMessage(parsed.error)
      });
    }
    const [module] = await getDatabase()
      .select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.id, parsed.data.moduleId), eq(modules.userId, locals.user!.id)))
      .limit(1);
    if (!module) {
      return fail(400, {
        action: 'createAssessment',
        error: 'Choose one of your modules.'
      });
    }
    await getDatabase()
      .insert(assessments)
      .values({
        userId: locals.user!.id,
        moduleId: parsed.data.moduleId,
        name: parsed.data.name,
        type: parsed.data.type,
        maximumMark: String(parsed.data.maximumMark),
        achievedMark: parsed.data.achievedMark === null ? null : String(parsed.data.achievedMark),
        weight: parsed.data.weight === null ? null : String(parsed.data.weight),
        assessmentDate: parsed.data.assessmentDate,
        targetMark: parsed.data.targetMark === null ? null : String(parsed.data.targetMark),
        notes: parsed.data.notes
      });
    return { action: 'createAssessment', success: true };
  }
};

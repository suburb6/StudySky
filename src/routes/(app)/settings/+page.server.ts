import { fail } from '@sveltejs/kit';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createAIProvider,
  decryptCredential,
  encryptCredential,
  encryptionConfigured
} from '$lib/server/ai';
import { hashPassword, normalizeEmail, verifyPassword } from '$lib/server/auth';
import { gradingPresetValues } from '$lib/domain/grading';
import { canonicalTimeZone, isValidTimeZone } from '$lib/domain/time';
import { defaultStorageQuotaBytes } from '$lib/server/config';
import { getDatabase } from '$lib/server/db';
import {
  aiSettings,
  auditLogs,
  documentAssets,
  modules,
  sessions,
  users
} from '$lib/server/db/schema';
import { formInteger, formString, issueMessage, optionalFormString } from '$lib/server/forms';
import type { Actions, PageServerLoad } from './$types';

const profileSchema = z.object({
  name: z.string().min(2).max(120),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine(isValidTimeZone, 'Enter a valid IANA timezone, such as UTC or Europe/Paris.')
    .transform((value) => canonicalTimeZone(value)!),
  sleepStart: z.string().regex(/^\d{2}:\d{2}$/),
  sleepEnd: z.string().regex(/^\d{2}:\d{2}$/),
  travelMinutes: z.number().int().min(0).max(360),
  preparationMinutes: z.number().int().min(0).max(180),
  preferredSessionMinutes: z.number().int().min(10).max(240),
  maxWeekdayStudyMinutes: z.number().int().min(0).max(1_440),
  maxWeekendStudyMinutes: z.number().int().min(0).max(1_440),
  preferredRestDay: z.number().int().min(0).max(6),
  eveningStudy: z.boolean(),
  automaticReschedule: z.boolean()
});

const aiSchema = z.object({
  provider: z.enum(['none', 'openai_compatible']),
  baseUrl: z.url().max(500).nullable(),
  model: z.string().max(200).nullable(),
  contextLimit: z.number().int().min(512).max(2_000_000),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxGeneratedTokens: z.number().int().min(32).max(100_000),
  embeddingProvider: z.string().max(200).nullable(),
  documentAnalysisEnabled: z.boolean()
});

const gradingSchema = z.object({
  enabled: z.boolean(),
  preset: z.enum(gradingPresetValues),
  passMark: z.union([z.literal(40), z.literal(50)]),
  formulaNotes: z.string().max(5_000)
});

export const load: PageServerLoad = async ({ locals }) => {
  const db = getDatabase();
  const userId = locals.user!.id;
  const [account] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      timezone: users.timezone,
      storageQuotaBytes: users.storageQuotaBytes,
      storageUsedBytes: users.storageUsedBytes,
      onboardingCompleted: users.onboardingCompleted,
      sleepStart: users.sleepStart,
      sleepEnd: users.sleepEnd,
      travelMinutes: users.travelMinutes,
      preparationMinutes: users.preparationMinutes,
      preferredSessionMinutes: users.preferredSessionMinutes,
      maxWeekdayStudyMinutes: users.maxWeekdayStudyMinutes,
      maxWeekendStudyMinutes: users.maxWeekendStudyMinutes,
      preferredRestDay: users.preferredRestDay,
      eveningStudy: users.eveningStudy,
      automaticReschedule: users.automaticReschedule,
      reminderPreferences: users.reminderPreferences,
      gradingPreferences: users.gradingPreferences
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw new Error('Account not found.');

  const [ai, actualUsage, moduleRows, memberRows] = await Promise.all([
    db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).limit(1),
    db
      .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
      .from(documentAssets)
      .where(eq(documentAssets.userId, userId)),
    db
      .select({ id: modules.id, code: modules.code, name: modules.name })
      .from(modules)
      .where(eq(modules.userId, userId))
      .orderBy(asc(modules.code)),
    account.role === 'admin'
      ? db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            quota: users.storageQuotaBytes,
            used: users.storageUsedBytes,
            createdAt: users.createdAt
          })
          .from(users)
          .orderBy(asc(users.email))
      : Promise.resolve([])
  ]);
  const aiValue = ai[0];
  return {
    account: { ...account, storageUsedBytes: Number(actualUsage[0]?.bytes ?? 0) },
    modules: moduleRows,
    members: memberRows,
    ai: aiValue
      ? {
          provider: aiValue.provider,
          baseUrl: aiValue.baseUrl,
          model: aiValue.model,
          contextLimit: aiValue.contextLimit,
          timeoutMs: aiValue.timeoutMs,
          maxGeneratedTokens: aiValue.maxGeneratedTokens,
          embeddingProvider: aiValue.embeddingProvider,
          documentAnalysisEnabled: aiValue.documentAnalysisEnabled,
          hasApiKey: Boolean(aiValue.encryptedApiKey)
        }
      : {
          provider: 'none',
          baseUrl: null,
          model: null,
          contextLimit: 8192,
          timeoutMs: 60000,
          maxGeneratedTokens: 800,
          embeddingProvider: null,
          documentAnalysisEnabled: false,
          hasApiKey: false
        },
    encryptionConfigured: encryptionConfigured()
  };
};

export const actions: Actions = {
  profile: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = profileSchema.safeParse({
      name: formString(form, 'name'),
      timezone: formString(form, 'timezone'),
      sleepStart: formString(form, 'sleepStart'),
      sleepEnd: formString(form, 'sleepEnd'),
      travelMinutes: formInteger(form, 'travelMinutes'),
      preparationMinutes: formInteger(form, 'preparationMinutes'),
      preferredSessionMinutes: formInteger(form, 'preferredSessionMinutes'),
      maxWeekdayStudyMinutes: formInteger(form, 'maxWeekdayStudyMinutes'),
      maxWeekendStudyMinutes: formInteger(form, 'maxWeekendStudyMinutes'),
      preferredRestDay: formInteger(form, 'preferredRestDay'),
      eveningStudy: form.has('eveningStudy'),
      automaticReschedule: form.has('automaticReschedule')
    });
    if (!parsed.success) {
      return fail(400, { action: 'profile', error: issueMessage(parsed.error) });
    }
    const reminderPreferences = Object.fromEntries(
      [
        'class_upcoming',
        'study_session',
        'assignment_deadline',
        'revision_due',
        'task_overdue',
        'scan_unprocessed',
        'weekly_planning'
      ].map((key) => [key, form.has(`reminder_${key}`)])
    );
    await getDatabase()
      .update(users)
      .set({
        ...parsed.data,
        reminderPreferences,
        onboardingCompleted: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, locals.user!.id));
    return { action: 'profile', success: true };
  },

  password: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(12, 'Use at least 12 characters.').max(200),
        confirmPassword: z.string().min(1)
      })
      .refine((value) => value.newPassword === value.confirmPassword, {
        message: 'The new passwords do not match.',
        path: ['confirmPassword']
      })
      .safeParse({
        currentPassword: formString(form, 'currentPassword'),
        newPassword: formString(form, 'newPassword'),
        confirmPassword: formString(form, 'confirmPassword')
      });
    if (!parsed.success) {
      return fail(400, { action: 'password', error: issueMessage(parsed.error) });
    }
    const db = getDatabase();
    const [account] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, locals.user!.id))
      .limit(1);
    if (!account || !(await verifyPassword(account.passwordHash, parsed.data.currentPassword))) {
      return fail(400, { action: 'password', error: 'Current password is incorrect.' });
    }
    if (await verifyPassword(account.passwordHash, parsed.data.newPassword)) {
      return fail(400, {
        action: 'password',
        error: 'Choose a password different from the current one.'
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
        .where(eq(users.id, locals.user!.id));
      if (locals.sessionId) {
        await tx
          .delete(sessions)
          .where(and(eq(sessions.userId, locals.user!.id), ne(sessions.id, locals.sessionId)));
      } else {
        await tx.delete(sessions).where(eq(sessions.userId, locals.user!.id));
      }
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: locals.user!.id,
        action: 'account.password_changed',
        entityType: 'user',
        entityId: locals.user!.id,
        ipAddress: locals.clientAddress
      });
    });
    return { action: 'password', success: true };
  },

  ai: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, { action: 'ai', error: 'Administrator access required.' });
    }
    const form = await request.formData();
    const parsed = aiSchema.safeParse({
      provider: formString(form, 'provider'),
      baseUrl: optionalFormString(form, 'baseUrl'),
      model: optionalFormString(form, 'model'),
      contextLimit: formInteger(form, 'contextLimit', 8192),
      timeoutMs: formInteger(form, 'timeoutMs', 60000),
      maxGeneratedTokens: formInteger(form, 'maxGeneratedTokens', 800),
      embeddingProvider: optionalFormString(form, 'embeddingProvider'),
      documentAnalysisEnabled: form.has('documentAnalysisEnabled')
    });
    if (!parsed.success) {
      return fail(400, { action: 'ai', error: issueMessage(parsed.error) });
    }
    const db = getDatabase();
    const [existing] = await db
      .select({ encryptedApiKey: aiSettings.encryptedApiKey })
      .from(aiSettings)
      .where(eq(aiSettings.userId, locals.user!.id))
      .limit(1);
    const apiKey = optionalFormString(form, 'apiKey');
    let encryptedApiKey = form.has('removeApiKey') ? null : (existing?.encryptedApiKey ?? null);
    if (apiKey) {
      try {
        encryptedApiKey = encryptCredential(apiKey);
      } catch (error) {
        return fail(400, {
          action: 'ai',
          error: error instanceof Error ? error.message : 'Could not encrypt API key.'
        });
      }
    }
    await db
      .insert(aiSettings)
      .values({
        userId: locals.user!.id,
        ...parsed.data,
        encryptedApiKey,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: aiSettings.userId,
        set: { ...parsed.data, encryptedApiKey, updatedAt: new Date() }
      });
    return { action: 'ai', success: true };
  },

  testAI: async ({ locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, { action: 'testAI', error: 'Administrator access required.' });
    }
    const [setting] = await getDatabase()
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, locals.user!.id))
      .limit(1);
    if (!setting) {
      return { action: 'testAI', success: true, testMessage: 'No AI is configured.' };
    }
    try {
      const provider = createAIProvider({
        provider: setting.provider,
        baseUrl: setting.baseUrl,
        model: setting.model,
        apiKey: decryptCredential(setting.encryptedApiKey),
        timeoutMs: setting.timeoutMs
      });
      const result = await provider.testConnection();
      return {
        action: 'testAI',
        success: result.ok,
        testMessage: result.message,
        models: result.models
      };
    } catch (error) {
      return fail(400, {
        action: 'testAI',
        error: error instanceof Error ? error.message : 'Connection test failed.'
      });
    }
  },

  grading: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = gradingSchema.safeParse({
      enabled: form.has('enabled'),
      preset: formString(form, 'preset'),
      passMark: Number(formString(form, 'passMark')),
      formulaNotes: formString(form, 'formulaNotes')
    });
    if (!parsed.success) {
      return fail(400, { action: 'grading', error: issueMessage(parsed.error) });
    }
    await getDatabase()
      .update(users)
      .set({
        gradingPreferences: parsed.data,
        updatedAt: new Date()
      })
      .where(eq(users.id, locals.user!.id));
    return { action: 'grading', success: true };
  },

  createMember: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, { action: 'createMember', error: 'Administrator access required.' });
    }
    const form = await request.formData();
    const parsed = z
      .object({
        name: z.string().min(2).max(120),
        email: z.email(),
        password: z.string().min(12, 'Use at least 12 characters.').max(200),
        quotaGb: z.number().min(0.25).max(10_000)
      })
      .safeParse({
        name: formString(form, 'name'),
        email: normalizeEmail(formString(form, 'email')),
        password: formString(form, 'password'),
        quotaGb: Number(formString(form, 'quotaGb')) || defaultStorageQuotaBytes() / 1024 ** 3
      });
    if (!parsed.success) {
      return fail(400, { action: 'createMember', error: issueMessage(parsed.error) });
    }
    const db = getDatabase();
    try {
      const [member] = await db
        .insert(users)
        .values({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash: await hashPassword(parsed.data.password),
          role: 'member',
          storageQuotaBytes: Math.round(parsed.data.quotaGb * 1024 ** 3)
        })
        .returning({ id: users.id });
      await db.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: member.id,
        action: 'account.created',
        entityType: 'user',
        entityId: member.id
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return fail(409, { action: 'createMember', error: 'That email is already in use.' });
      }
      throw error;
    }
    return { action: 'createMember', success: true };
  },

  quota: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, { action: 'quota', error: 'Administrator access required.' });
    }
    const form = await request.formData();
    const userId = z.uuid().safeParse(formString(form, 'userId'));
    const quotaGb = Number(formString(form, 'quotaGb'));
    if (!userId.success || !Number.isFinite(quotaGb) || quotaGb < 0.25 || quotaGb > 10_000) {
      return fail(400, { action: 'quota', error: 'Enter a valid quota.' });
    }
    const db = getDatabase();
    const [target] = await db
      .select({ used: users.storageUsedBytes })
      .from(users)
      .where(eq(users.id, userId.data))
      .limit(1);
    const quota = Math.round(quotaGb * 1024 ** 3);
    if (!target || quota < target.used) {
      return fail(400, {
        action: 'quota',
        error: 'Quota cannot be lower than the account’s current storage use.'
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ storageQuotaBytes: quota, updatedAt: new Date() })
        .where(eq(users.id, userId.data));
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: userId.data,
        action: 'storage.quota_changed',
        entityType: 'user',
        entityId: userId.data,
        detail: { quotaBytes: quota }
      });
    });
    return { action: 'quota', success: true };
  }
};

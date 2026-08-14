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
import {
  normaliseOcrProviderUrl,
  parseOcrCapabilities,
  parseOcrLanguages,
  testCustomOcrProvider
} from '$lib/server/custom-ocr-provider';
import { getDatabase } from '$lib/server/db';
import {
  aiSettings,
  auditLogs,
  documentAssets,
  modules,
  ocrProviders,
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

const ocrProviderSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().min(2).max(120),
  baseUrl: z.string().min(1).max(500),
  capabilities: z.array(z.enum(['text', 'formula_latex'])).min(1),
  languages: z.array(z.string().min(1).max(40)).max(20),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(5_000).max(180_000),
  maxImageMb: z.number().int().min(1).max(12),
  maxPixels: z.number().int().min(1_000_000).max(40_000_000)
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

  const [ai, actualUsage, moduleRows, memberRows, ocrProviderRows] = await Promise.all([
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
      : Promise.resolve([]),
    account.role === 'admin'
      ? db.select().from(ocrProviders).orderBy(asc(ocrProviders.name))
      : Promise.resolve([])
  ]);
  const aiValue = ai[0];
  return {
    account: { ...account, storageUsedBytes: Number(actualUsage[0]?.bytes ?? 0) },
    modules: moduleRows,
    members: memberRows,
    ocrProviders: ocrProviderRows.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      capabilities: parseOcrCapabilities(provider.capabilities),
      languages: parseOcrLanguages(provider.languages),
      enabled: provider.enabled,
      timeoutMs: provider.timeoutMs,
      maxImageMb: Math.round(provider.maxImageBytes / 1024 / 1024),
      maxPixels: provider.maxPixels,
      hasToken: Boolean(provider.encryptedToken)
    })),
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

  saveOcrProvider: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, {
        action: 'saveOcrProvider',
        error: 'Administrator access required.'
      });
    }
    const form = await request.formData();
    const languages = formString(form, 'languages')
      .split(',')
      .map((language) => language.trim())
      .filter(Boolean);
    const parsed = ocrProviderSchema.safeParse({
      id: optionalFormString(form, 'id'),
      name: formString(form, 'name'),
      baseUrl: formString(form, 'baseUrl'),
      capabilities: ['text', 'formula_latex'].filter((value) => form.has(`capability_${value}`)),
      languages,
      enabled: form.has('enabled'),
      timeoutMs: formInteger(form, 'timeoutMs', 90_000),
      maxImageMb: formInteger(form, 'maxImageMb', 6),
      maxPixels: formInteger(form, 'maxPixels', 16_000_000)
    });
    if (!parsed.success) {
      return fail(400, { action: 'saveOcrProvider', error: issueMessage(parsed.error) });
    }
    let baseUrl: string;
    try {
      baseUrl = normaliseOcrProviderUrl(parsed.data.baseUrl);
    } catch (error) {
      return fail(400, {
        action: 'saveOcrProvider',
        error: error instanceof Error ? error.message : 'Enter a valid provider URL.'
      });
    }

    const db = getDatabase();
    const existing = parsed.data.id
      ? await db
          .select({ encryptedToken: ocrProviders.encryptedToken })
          .from(ocrProviders)
          .where(eq(ocrProviders.id, parsed.data.id))
          .limit(1)
      : [];
    if (parsed.data.id && !existing[0]) {
      return fail(404, { action: 'saveOcrProvider', error: 'OCR model not found.' });
    }
    const token = optionalFormString(form, 'token');
    let encryptedToken = form.has('removeToken') ? null : (existing[0]?.encryptedToken ?? null);
    if (token) {
      try {
        encryptedToken = encryptCredential(token);
      } catch (error) {
        return fail(400, {
          action: 'saveOcrProvider',
          error: error instanceof Error ? error.message : 'Could not encrypt provider token.'
        });
      }
    }
    const values = {
      name: parsed.data.name,
      baseUrl,
      capabilities: parsed.data.capabilities,
      languages: parsed.data.languages,
      enabled: parsed.data.enabled,
      timeoutMs: parsed.data.timeoutMs,
      maxImageBytes: parsed.data.maxImageMb * 1024 * 1024,
      maxPixels: parsed.data.maxPixels,
      encryptedToken,
      updatedAt: new Date()
    };
    let providerId = parsed.data.id;
    await db.transaction(async (tx) => {
      if (providerId) {
        await tx.update(ocrProviders).set(values).where(eq(ocrProviders.id, providerId));
      } else {
        const [created] = await tx
          .insert(ocrProviders)
          .values({ ...values, createdByUserId: locals.user!.id })
          .returning({ id: ocrProviders.id });
        providerId = created.id;
      }
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        action: parsed.data.id ? 'ocr_provider.updated' : 'ocr_provider.created',
        entityType: 'ocr_provider',
        entityId: providerId,
        detail: { name: parsed.data.name, capabilities: parsed.data.capabilities }
      });
    });
    return { action: 'saveOcrProvider', success: true };
  },

  testOcrProvider: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, {
        action: 'testOcrProvider',
        error: 'Administrator access required.'
      });
    }
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'id'));
    if (!id.success) {
      return fail(400, { action: 'testOcrProvider', error: 'OCR model not found.' });
    }
    const [provider] = await getDatabase()
      .select()
      .from(ocrProviders)
      .where(eq(ocrProviders.id, id.data))
      .limit(1);
    if (!provider) {
      return fail(404, { action: 'testOcrProvider', error: 'OCR model not found.' });
    }
    try {
      const result = await testCustomOcrProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        token: decryptCredential(provider.encryptedToken),
        capabilities: parseOcrCapabilities(provider.capabilities),
        languages: parseOcrLanguages(provider.languages),
        timeoutMs: provider.timeoutMs,
        maxImageBytes: provider.maxImageBytes,
        maxPixels: provider.maxPixels
      });
      if (!result.ok) {
        return fail(400, {
          action: 'testOcrProvider',
          error: result.message,
          providerId: provider.id
        });
      }
      return {
        action: 'testOcrProvider',
        success: true,
        testMessage: result.message,
        providerId: provider.id
      };
    } catch (error) {
      return fail(400, {
        action: 'testOcrProvider',
        error: error instanceof Error ? error.message : 'Connection test failed.'
      });
    }
  },

  deleteOcrProvider: async ({ request, locals }) => {
    if (locals.user!.role !== 'admin') {
      return fail(403, {
        action: 'deleteOcrProvider',
        error: 'Administrator access required.'
      });
    }
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'id'));
    if (!id.success) {
      return fail(400, { action: 'deleteOcrProvider', error: 'OCR model not found.' });
    }
    await getDatabase().transaction(async (tx) => {
      await tx.delete(ocrProviders).where(eq(ocrProviders.id, id.data));
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        action: 'ocr_provider.deleted',
        entityType: 'ocr_provider',
        entityId: id.data
      });
    });
    return { action: 'deleteOcrProvider', success: true };
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

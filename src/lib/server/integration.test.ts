import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  authenticate,
  createSession,
  hashPassword,
  LoginBlockedError,
  resolveSession
} from './auth';
import { closeDatabase, getDatabase } from './db';
import {
  chapters,
  documentShares,
  documents,
  modules,
  practiceAttempts,
  practiceQuestions,
  pushSubscriptions,
  sessions,
  tasks,
  timetableEntries,
  uploadSessions,
  users
} from './db/schema';
import {
  createDocumentFromFile,
  createUploadSession,
  DuplicateUploadError,
  InvalidUploadError,
  QuotaExceededError
} from './documents';
import { GET as getDocumentAsset } from '../../routes/api/documents/[id]/[kind]/+server';
import { POST as uploadDocument } from '../../routes/api/uploads/+server';
import { actions as moduleActions } from '../../routes/(app)/modules/+page.server';
import { load as searchLoad } from '../../routes/(app)/search/+page.server';
import { actions as taskActions } from '../../routes/(app)/tasks/+page.server';
import { actions as timetableActions } from '../../routes/(app)/timetable/+page.server';
import { listTasks, todayOverview } from './services/study';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe.sequential : describe.skip;
let storageRoot = '';
let userA: typeof users.$inferSelect;
let userB: typeof users.$inferSelect;
let moduleId = '';
let chapterId = '';
let documentId = '';

integration('PostgreSQL integration and permission boundaries', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DISABLE_BACKGROUND_JOBS = 'true';
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'studysky-integration-'));
    process.env.STORAGE_ROOT = storageRoot;
    const suffix = crypto.randomUUID();
    const passwordHash = await hashPassword('integration-password-123');
    [userA] = await getDatabase()
      .insert(users)
      .values({
        email: `owner-${suffix}@example.test`,
        name: 'Integration owner',
        passwordHash,
        role: 'admin',
        storageQuotaBytes: 1024 * 1024
      })
      .returning();
    [userB] = await getDatabase()
      .insert(users)
      .values({
        email: `friend-${suffix}@example.test`,
        name: 'Integration friend',
        passwordHash,
        storageQuotaBytes: 1024 * 1024
      })
      .returning();
  });

  afterAll(async () => {
    if (userA?.id) {
      await getDatabase().delete(users).where(eq(users.id, userA.id));
    }
    if (userB?.id) {
      await getDatabase().delete(users).where(eq(users.id, userB.id));
    }
    await closeDatabase();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('creates and resolves opaque server-side sessions', async () => {
    const session = await createSession(userA.id, '127.0.0.1', 'vitest');
    expect(session.token.length).toBeGreaterThan(30);
    const resolved = await resolveSession(session.token);
    expect(resolved?.user.id).toBe(userA.id);
    expect(resolved?.user.email).toBe(userA.email);
    await getDatabase()
      .insert(pushSubscriptions)
      .values({
        userId: userA.id,
        sessionId: resolved!.sessionId,
        endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
        p256dh: 'integration-public-key',
        auth: 'integration-auth-key'
      });
    await getDatabase().delete(sessions).where(eq(sessions.id, resolved!.sessionId));
    const remaining = await getDatabase()
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.sessionId, resolved!.sessionId));
    expect(remaining).toHaveLength(0);
  });

  it('serializes concurrent login attempts before password verification', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => authenticate(userA.email, 'wrong-password', '198.51.100.40'))
    );
    expect(
      results.filter((result) => result.status === 'fulfilled' && result.value === null)
    ).toHaveLength(5);
    expect(
      results.filter(
        (result) => result.status === 'rejected' && result.reason instanceof LoginBlockedError
      )
    ).toHaveLength(3);
    await expect(
      authenticate(userA.email, 'integration-password-123', '198.51.100.41')
    ).resolves.toMatchObject({ id: userA.id });
  });

  it('creates modules, chapters, and tasks without crossing user boundaries', async () => {
    const [module] = await getDatabase()
      .insert(modules)
      .values({
        userId: userA.id,
        code: `T${Date.now()}`,
        name: 'Integration module'
      })
      .returning();
    moduleId = module.id;
    const [chapter] = await getDatabase()
      .insert(chapters)
      .values({
        userId: userA.id,
        moduleId,
        title: 'Integration chapter'
      })
      .returning();
    chapterId = chapter.id;
    await getDatabase().insert(tasks).values({
      userId: userA.id,
      moduleId,
      chapterId,
      title: 'Integration task',
      type: 'exercise'
    });

    const visibleToOwner = await getDatabase()
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userA.id));
    const visibleToFriend = await getDatabase()
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userB.id));
    expect(visibleToOwner.some((task) => task.title === 'Integration task')).toBe(true);
    expect(visibleToFriend).toHaveLength(0);
  });

  it('loads typed dashboard and task date filters against PostgreSQL', async () => {
    const start = new Date('2026-08-03T20:00:00.000Z');
    const end = new Date('2026-08-04T19:59:00.000Z');
    const [overview, taskRows] = await Promise.all([
      todayOverview(userA.id, start, end),
      listTasks(userA.id, 'today')
    ]);
    expect(overview.storage.quota).toBe(1024 * 1024);
    expect(Array.isArray(overview.scheduled)).toBe(true);
    expect(Array.isArray(taskRows)).toBe(true);
  });

  it('rejects a queued upload when the signed-in account has changed', async () => {
    const before = await getDatabase()
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.userId, userB.id));
    const body = new FormData();
    body.set('ownerUserId', userA.id);
    body.set('files', new File(['queued note'], 'queued.txt', { type: 'text/plain' }));
    const handler = uploadDocument as unknown as (event: {
      request: Request;
      locals: { user: typeof userB };
    }) => Promise<Response>;
    const response = await handler({
      request: new Request('http://localhost/api/uploads', { method: 'POST', body }),
      locals: { user: userB }
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'owner_mismatch' });
    const after = await getDatabase()
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.userId, userB.id));
    expect(after).toHaveLength(before.length);
  });

  it('rejects an offline task draft when the signed-in account has changed', async () => {
    const before = await getDatabase()
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, userB.id));
    const body = new FormData();
    body.set('ownerUserId', userA.id);
    body.set('title', 'Queued task from another account');
    body.set('type', 'other');
    body.set('status', 'inbox');
    body.set('priority', 'normal');
    body.set('difficulty', '3');
    body.set('estimatedMinutes', '30');
    const create = taskActions.create as unknown as (event: {
      request: Request;
      locals: { user: typeof userB };
    }) => Promise<{ status?: number; data?: { code?: string } }>;
    const response = await create({
      request: new Request('http://localhost/tasks?/create', { method: 'POST', body }),
      locals: { user: userB }
    });
    expect(response.status).toBe(409);
    expect(response.data?.code).toBe('owner_mismatch');
    const after = await getDatabase()
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, userB.id));
    expect(after).toHaveLength(before.length);
  });

  it('validates file content, organises scan uploads, detects duplicates, and enforces quota', async () => {
    await expect(
      createDocumentFromFile({
        userId: userA.id,
        file: new File(['not actually a PDF'], 'fake.pdf', { type: 'application/pdf' }),
        metadata: { organiseLater: true }
      })
    ).rejects.toBeInstanceOf(InvalidUploadError);

    const pdfBytes = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'
    );
    const created = await createDocumentFromFile({
      userId: userA.id,
      file: new File([pdfBytes], 'lecture.pdf', { type: 'application/pdf' }),
      metadata: {
        moduleId,
        chapterId,
        section: 'Lecturer Materials',
        type: 'lecturer_notes',
        title: 'Integration lecture',
        documentDate: '2026-08-04'
      }
    });
    documentId = created.id;
    expect(created.moduleId).toBe(moduleId);
    expect(created.chapterId).toBe(chapterId);

    await expect(
      createDocumentFromFile({
        userId: userA.id,
        file: new File([pdfBytes], 'same-content.pdf', { type: 'application/pdf' }),
        metadata: { organiseLater: true }
      })
    ).rejects.toBeInstanceOf(DuplicateUploadError);

    await getDatabase()
      .update(users)
      .set({ storageQuotaBytes: created.byteSize + 8 })
      .where(eq(users.id, userA.id));
    const differentPdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Version /1.7 >>\nendobj\n%%EOF\n'
    );
    await expect(
      createDocumentFromFile({
        userId: userA.id,
        file: new File([differentPdf], 'too-large.pdf', { type: 'application/pdf' }),
        metadata: { organiseLater: true }
      })
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('reserves quota across concurrent resumable upload sessions', async () => {
    await getDatabase()
      .update(users)
      .set({ storageQuotaBytes: 1024 })
      .where(eq(users.id, userB.id));
    await createUploadSession({
      userId: userB.id,
      originalFilename: 'first.pdf',
      expectedBytes: 700,
      metadata: { organiseLater: true }
    });
    await expect(
      createUploadSession({
        userId: userB.id,
        originalFilename: 'second.pdf',
        expectedBytes: 700,
        metadata: { organiseLater: true }
      })
    ).rejects.toBeInstanceOf(QuotaExceededError);
    await getDatabase().delete(uploadSessions).where(eq(uploadSessions.userId, userB.id));
  });

  it('rejects IDOR access and permits only explicit active shares', async () => {
    const handler = getDocumentAsset as unknown as (event: {
      locals: { user: typeof userB };
      params: { id: string; kind: string };
      url: URL;
    }) => Promise<Response>;
    const event = {
      locals: { user: userB },
      params: { id: documentId, kind: 'original' },
      url: new URL(`http://localhost/api/documents/${documentId}/original`)
    };
    expect((await handler(event)).status).toBe(404);

    const [share] = await getDatabase()
      .insert(documentShares)
      .values({
        documentId,
        ownerId: userA.id,
        sharedWithUserId: userB.id,
        permission: 'read'
      })
      .returning();
    const allowed = await handler(event);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain('%PDF-1.4');

    const search = searchLoad as unknown as (event: {
      locals: { user: typeof userA };
      url: URL;
    }) => Promise<{
      results: {
        documents: Array<{
          id: string;
          moduleCode: string | null;
          moduleColor: string | null;
          chapterTitle: string | null;
        }>;
      };
    }>;
    const sharedSearch = await search({
      locals: { user: userB },
      url: new URL('http://localhost/search?q=Integration%20lecture')
    });
    expect(sharedSearch.results.documents).toContainEqual(
      expect.objectContaining({
        id: documentId,
        moduleCode: null,
        moduleColor: null,
        chapterTitle: null
      })
    );
    const ownerSearch = await search({
      locals: { user: userA },
      url: new URL('http://localhost/search?q=Integration%20lecture')
    });
    expect(ownerSearch.results.documents).toContainEqual(
      expect.objectContaining({
        id: documentId,
        chapterTitle: 'Integration chapter'
      })
    );

    await getDatabase()
      .update(documentShares)
      .set({ revokedAt: new Date() })
      .where(eq(documentShares.id, share.id));
    expect((await handler(event)).status).toBe(404);
  });

  it('allows overlapping calendar entries while preserving both events', async () => {
    await getDatabase().insert(timetableEntries).values({
      userId: userA.id,
      title: 'Existing class',
      kind: 'class',
      isRecurring: true,
      dayOfWeek: 2,
      startTime: '09:00',
      endTime: '12:00'
    });
    const body = new FormData();
    body.set('title', 'Conflicting work');
    body.set('kind', 'work');
    body.set('recurrence', 'weekly');
    body.set('dayOfWeek', '2');
    body.set('startTime', '11:00');
    body.set('endTime', '13:00');
    const create = timetableActions.create as unknown as (event: {
      request: Request;
      locals: { user: typeof userA };
    }) => Promise<{ success?: boolean }>;
    const response = await create({
      request: new Request('http://localhost/timetable?/create', {
        method: 'POST',
        body
      }),
      locals: { user: userA }
    });
    expect(response.success).toBe(true);
    const rows = await getDatabase()
      .select({ id: timetableEntries.id })
      .from(timetableEntries)
      .where(and(eq(timetableEntries.userId, userA.id), eq(timetableEntries.dayOfWeek, 2)));
    expect(rows).toHaveLength(2);
  });

  it('changes timezone defaults without rewriting existing account or timetable rows', async () => {
    const db = getDatabase();
    const [legacyUser] = await db
      .insert(users)
      .values({
        email: `timezone-${crypto.randomUUID()}@example.test`,
        name: 'Timezone migration fixture',
        passwordHash: await hashPassword('integration-password-123'),
        timezone: 'Indian/Mauritius'
      })
      .returning();
    const [legacyEntry] = await db
      .insert(timetableEntries)
      .values({
        userId: legacyUser.id,
        title: 'Migration fixture',
        kind: 'class',
        timezone: 'Indian/Mauritius',
        isRecurring: true,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00'
      })
      .returning();

    await db.execute(
      sql.raw(`ALTER TABLE "timetable_entries" ALTER COLUMN "timezone" SET DEFAULT 'UTC'`)
    );
    await db.execute(sql.raw(`ALTER TABLE "users" ALTER COLUMN "timezone" SET DEFAULT 'UTC'`));

    const [preservedUser] = await db
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, legacyUser.id));
    const [preservedEntry] = await db
      .select({ timezone: timetableEntries.timezone })
      .from(timetableEntries)
      .where(eq(timetableEntries.id, legacyEntry.id));
    expect(preservedUser.timezone).toBe('Indian/Mauritius');
    expect(preservedEntry.timezone).toBe('Indian/Mauritius');
    await db.delete(users).where(eq(users.id, legacyUser.id));
  });

  it('connects an existing class to a newly created matching module', async () => {
    const [orphan] = await getDatabase()
      .insert(timetableEntries)
      .values({
        userId: userB.id,
        title: 'Interaction design seminar',
        kind: 'class',
        isRecurring: true,
        dayOfWeek: 3,
        startTime: '08:00',
        endTime: '10:00'
      })
      .returning({ id: timetableEntries.id });
    const body = new FormData();
    body.set('code', 'ux101');
    body.set('name', 'Interaction design');
    body.set('color', '#2563eb');
    const create = moduleActions.create as unknown as (event: {
      request: Request;
      locals: { user: typeof userB };
    }) => Promise<{ success?: boolean }>;
    const response = await create({
      request: new Request('http://localhost/modules?/create', {
        method: 'POST',
        body
      }),
      locals: { user: userB }
    });
    expect(response.success).toBe(true);
    const [linked] = await getDatabase()
      .select({ moduleId: timetableEntries.moduleId })
      .from(timetableEntries)
      .where(eq(timetableEntries.id, orphan.id));
    expect(linked.moduleId).not.toBeNull();
  });

  it('records practice completion for the correct user only', async () => {
    const [question] = await getDatabase()
      .insert(practiceQuestions)
      .values({
        userId: userA.id,
        moduleId,
        chapterId,
        mode: 'short_answer',
        prompt: 'What is a node?',
        answer: 'A data element with links.'
      })
      .returning();
    await getDatabase().insert(practiceAttempts).values({
      userId: userA.id,
      questionId: question.id,
      answer: 'A data element with links.',
      result: 'correct',
      confidenceBefore: 4,
      secondsTaken: 12
    });
    const ownerAttempts = await getDatabase()
      .select()
      .from(practiceAttempts)
      .where(
        and(eq(practiceAttempts.userId, userA.id), eq(practiceAttempts.questionId, question.id))
      );
    const friendAttempts = await getDatabase()
      .select()
      .from(practiceAttempts)
      .where(eq(practiceAttempts.userId, userB.id));
    expect(ownerAttempts).toHaveLength(1);
    expect(friendAttempts).toHaveLength(0);
  });
});

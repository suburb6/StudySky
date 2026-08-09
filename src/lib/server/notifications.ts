import webpush from 'web-push';
import { and, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  canonicalTimeZone,
  dateKeyAddDays,
  dateKeyInTimeZone,
  formatDateInTimeZone,
  minutesFromTime,
  minutesInTimeZone,
  weekdayInTimeZone
} from '$lib/domain/time';
import { getDatabase } from './db';
import {
  documents,
  notifications,
  pushSubscriptions,
  revisionItems,
  tasks,
  timetableEntries,
  users,
  sessions
} from './db/schema';
import { getPushDeliveryAgent, normalizePushEndpoint } from './push-security';

type NotificationValue = typeof notifications.$inferInsert;

export async function generateNotifications(): Promise<number> {
  const db = getDatabase();
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
  const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1_000);
  const accountRows = await db
    .select({
      id: users.id,
      preferences: users.reminderPreferences,
      timezone: users.timezone
    })
    .from(users);
  let createdCount = 0;

  for (const account of accountRows) {
    const timeZone = canonicalTimeZone(account.timezone) ?? 'UTC';
    const preferences = account.preferences ?? {};
    const pending: NotificationValue[] = [];
    const [deadlineTasks, scheduledTasks, dueRevisions, waitingDocuments, classes] =
      await Promise.all([
        db
          .select({
            id: tasks.id,
            title: tasks.title,
            deadline: tasks.deadline,
            type: tasks.type
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.userId, account.id),
              inArray(tasks.status, ['inbox', 'this_week', 'doing', 'waiting']),
              lte(tasks.deadline, inTwoDays)
            )
          )
          .limit(100),
        db
          .select({ id: tasks.id, title: tasks.title, start: tasks.scheduledStart })
          .from(tasks)
          .where(
            and(
              eq(tasks.userId, account.id),
              inArray(tasks.status, ['inbox', 'this_week', 'doing', 'waiting']),
              lte(tasks.scheduledStart, inTwoHours),
              gte(tasks.scheduledStart, now)
            )
          )
          .limit(50),
        db
          .select({ id: revisionItems.id, title: revisionItems.title, dueAt: revisionItems.dueAt })
          .from(revisionItems)
          .where(
            and(
              eq(revisionItems.userId, account.id),
              inArray(revisionItems.state, ['due', 'upcoming']),
              lte(revisionItems.dueAt, now)
            )
          )
          .limit(100),
        db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(
            and(
              eq(documents.userId, account.id),
              inArray(documents.processingStatus, ['uploaded', 'queued', 'failed']),
              lt(documents.createdAt, new Date(now.getTime() - 30 * 60 * 1_000))
            )
          )
          .limit(100),
        db
          .select({
            id: timetableEntries.id,
            title: timetableEntries.title,
            startTime: timetableEntries.startTime,
            dayOfWeek: timetableEntries.dayOfWeek
          })
          .from(timetableEntries)
          .where(
            and(
              eq(timetableEntries.userId, account.id),
              eq(timetableEntries.kind, 'class'),
              eq(timetableEntries.isRecurring, true)
            )
          )
      ]);

    for (const task of deadlineTasks) {
      if (!task.deadline) continue;
      const overdue = task.deadline < now;
      const enabled = overdue
        ? preferences.task_overdue !== false
        : preferences.assignment_deadline !== false;
      if (!enabled) continue;
      pending.push({
        userId: account.id,
        kind: overdue ? 'task_overdue' : 'assignment_deadline',
        title: overdue ? `Overdue: ${task.title}` : `Deadline approaching: ${task.title}`,
        body: overdue
          ? 'Review the task and choose a realistic next action.'
          : `Due ${formatForAccount(task.deadline, timeZone)}.`,
        href: '/tasks',
        sourceKey: `${overdue ? 'overdue' : 'deadline'}:${task.id}:${dateKeyInTimeZone(now, timeZone)}`
      });
    }
    if (preferences.study_session !== false) {
      for (const task of scheduledTasks) {
        pending.push({
          userId: account.id,
          kind: 'study_session',
          title: `Study session: ${task.title}`,
          body: task.start ? `Starts ${formatForAccount(task.start, timeZone)}.` : null,
          href: '/today',
          sourceKey: `study:${task.id}:${task.start?.toISOString() ?? 'unknown'}`
        });
      }
    }
    if (preferences.revision_due !== false) {
      for (const revision of dueRevisions) {
        pending.push({
          userId: account.id,
          kind: 'revision_due',
          title: `Revision due: ${revision.title}`,
          body: 'A short active-recall review is ready.',
          href: '/revision',
          sourceKey: `revision:${revision.id}:${dateKeyInTimeZone(revision.dueAt, timeZone)}`
        });
      }
    }
    if (preferences.scan_unprocessed !== false) {
      for (const document of waitingDocuments) {
        pending.push({
          userId: account.id,
          kind: 'scan_unprocessed',
          title: `Scan needs attention: ${document.title}`,
          body: 'The original remains available even if processing failed.',
          href: `/documents?preview=${document.id}`,
          sourceKey: `scan:${document.id}`
        });
      }
    }

    if (preferences.class_upcoming !== false) {
      const weekday = weekdayInTimeZone(now, timeZone);
      const minuteNow = minutesInTimeZone(now, timeZone);
      for (const entry of classes) {
        const until = minutesUntilRecurringClass(
          weekday,
          minuteNow,
          entry.dayOfWeek ?? 0,
          minutesFromTime(entry.startTime)
        );
        if (until < 0 || until > 120) continue;
        pending.push({
          userId: account.id,
          kind: 'class_upcoming',
          title: `Class soon: ${entry.title}`,
          body: `Starts in ${until} minute${until === 1 ? '' : 's'}.`,
          href: '/timetable',
          sourceKey: `class:${entry.id}:${dateKeyInTimeZone(now, timeZone)}`
        });
      }
    }
    if (preferences.weekly_planning !== false && shouldPromptForWeeklyPlanning(now, timeZone)) {
      const today = dateKeyInTimeZone(now, timeZone);
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const weekStart = dateKeyAddDays(today, -weekday);
      pending.push({
        userId: account.id,
        kind: 'weekly_planning',
        title: 'Plan the study week',
        body: 'Preview a realistic plan around classes, deadlines, revision, and rest.',
        href: '/planning',
        sourceKey: `weekly-planning:${weekStart}`
      });
    }

    if (pending.length) {
      const inserted = await db
        .insert(notifications)
        .values(pending)
        .onConflictDoNothing()
        .returning();
      createdCount += inserted.length;
      if (inserted.length) await sendPushForNotifications(account.id, inserted);
    }
  }
  return createdCount;
}

async function sendPushForNotifications(
  userId: string,
  rows: Array<typeof notifications.$inferSelect>
): Promise<void> {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const db = getDatabase();
  const subscriptions = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth
    })
    .from(pushSubscriptions)
    .innerJoin(sessions, eq(pushSubscriptions.sessionId, sessions.id))
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date())
      )
    );
  const latest = rows.at(-1);
  if (!latest) return;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const endpoint = normalizePushEndpoint(subscription.endpoint);
        await webpush.sendNotification(
          {
            endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          JSON.stringify({
            title: latest.title,
            body: latest.body,
            href: latest.href ?? '/notifications'
          }),
          {
            TTL: 3600,
            urgency: 'normal',
            timeout: 15_000,
            agent: getPushDeliveryAgent()
          }
        );
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number(error.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
        } else {
          console.error(
            'Push notification failed',
            error instanceof Error ? error.message : 'unknown error'
          );
        }
      }
    })
  );
}

function minutesUntilRecurringClass(
  today: number,
  minuteNow: number,
  classDay: number,
  classMinute: number
) {
  return ((classDay - today + 7) % 7) * 24 * 60 + classMinute - minuteNow;
}

function formatForAccount(date: Date, timeZone: string) {
  return formatDateInTimeZone(date, timeZone, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shouldPromptForWeeklyPlanning(now: Date, timeZone: string): boolean {
  const weekday = weekdayInTimeZone(now, timeZone);
  const hour = Math.floor(minutesInTimeZone(now, timeZone) / 60);
  return (weekday === 0 && hour >= 17) || (weekday === 1 && hour < 10);
}

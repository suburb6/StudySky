import { PgBoss } from 'pg-boss';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, getDatabaseUrl } from './lib/server/db/index';
import { removeExpiredSessions } from './lib/server/auth';
import { processDocument, type DocumentProcessingInput } from './lib/server/document-processing';
import { generateNotifications } from './lib/server/notifications';
import { removeExpiredUploadSessions } from './lib/server/documents';
import { documents } from './lib/server/db/schema';

const boss = new PgBoss({
  connectionString: getDatabaseUrl(),
  application_name: 'studysky-worker'
});

boss.on('error', (error) => {
  console.error('Background queue error', error);
});

await boss.start();
await boss.createQueue('maintenance.sessions');
await boss.createQueue('document.process');
await boss.createQueue('maintenance.notifications');
await boss.createQueue('maintenance.documents');
await boss.schedule('maintenance.sessions', '15 * * * *', {}, { tz: 'UTC' });
await boss.schedule('maintenance.notifications', '*/15 * * * *', {}, { tz: 'UTC' });
await boss.schedule('maintenance.documents', '*/10 * * * *', {}, { tz: 'UTC' });
await boss.work('maintenance.sessions', async () => {
  const count = await removeExpiredSessions();
  if (count > 0) console.log(`Removed ${count} expired session(s).`);
});
await boss.work<DocumentProcessingInput>('document.process', async (jobs) => {
  for (const job of jobs) {
    await processDocument(job.data);
  }
});
await boss.work('maintenance.notifications', async () => {
  const count = await generateNotifications();
  if (count > 0) console.log(`Created ${count} notification(s).`);
});
await boss.work('maintenance.documents', async () => {
  const expired = await removeExpiredUploadSessions();
  const waiting = await getDatabase()
    .select({ id: documents.id, userId: documents.userId })
    .from(documents)
    .where(eq(documents.processingStatus, 'uploaded'))
    .limit(100);
  for (const document of waiting) {
    await boss.send(
      'document.process',
      { documentId: document.id, userId: document.userId, version: 1 },
      { retryLimit: 3, retryDelay: 30, retryBackoff: true }
    );
    await getDatabase()
      .update(documents)
      .set({ processingStatus: 'queued', processingError: null, updatedAt: new Date() })
      .where(eq(documents.id, document.id));
  }
  if (expired || waiting.length) {
    console.log(
      `Document maintenance: ${expired} expired upload(s), ${waiting.length} requeued document(s).`
    );
  }
});

console.log('StudySky worker is ready.');

async function shutdown(signal: string) {
  console.log(`Received ${signal}; stopping worker.`);
  await boss.stop({ graceful: true });
  await closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

import { PgBoss } from 'pg-boss';
import { getDatabaseUrl } from './db';

let bossPromise: Promise<PgBoss> | undefined;

export function getJobBoss(): Promise<PgBoss> {
  bossPromise ??= startBoss();
  return bossPromise;
}

async function startBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: getDatabaseUrl(),
    application_name: 'studysky-web'
  });
  boss.on('error', (error) => console.error('Job queue error', error));
  await boss.start();
  await boss.createQueue('document.process');
  return boss;
}

export async function enqueueDocumentProcessing(documentId: string, userId: string): Promise<void> {
  if (process.env.DISABLE_BACKGROUND_JOBS === 'true') return;
  const boss = await getJobBoss();
  await boss.send(
    'document.process',
    { documentId, userId, version: 1 },
    { retryLimit: 3, retryDelay: 30, retryBackoff: true }
  );
}

export async function closeJobBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  await boss.stop({ graceful: true });
  bossPromise = undefined;
}

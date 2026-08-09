import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDatabase, getDatabase } from './lib/server/db/index';

try {
  await migrate(getDatabase(), { migrationsFolder: 'drizzle' });
  console.log('Database migrations are current.');
} finally {
  await closeDatabase();
}

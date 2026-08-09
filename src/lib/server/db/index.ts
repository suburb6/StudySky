import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL is required');
  }
  return value;
}

export function getDatabase() {
  if (!database) {
    client = postgres(getDatabaseUrl(), {
      max: Number(process.env.DB_POOL_SIZE ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false
    });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    database = undefined;
  }
}

export type Database = ReturnType<typeof getDatabase>;

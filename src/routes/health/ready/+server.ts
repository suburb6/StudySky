import { sql } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    await getDatabase().execute(sql`select 1`);
    return json({ status: 'ready', database: 'ok' });
  } catch {
    return json({ status: 'not_ready', database: 'unavailable' }, { status: 503 });
  }
};

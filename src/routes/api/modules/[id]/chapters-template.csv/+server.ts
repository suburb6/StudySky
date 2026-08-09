import { and, eq } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import { modules } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return new Response('Authentication required', { status: 401 });
  const [module] = await getDatabase()
    .select({ code: modules.code })
    .from(modules)
    .where(and(eq(modules.id, params.id), eq(modules.userId, locals.user.id)))
    .limit(1);
  if (!module) return new Response('Not found', { status: 404 });
  return new Response('title,description\r\nExample chapter,Short optional description\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${module.code.replaceAll(/[^A-Za-z0-9_-]/g, '_')}_chapters.csv"`,
      'cache-control': 'private, no-store'
    }
  });
};

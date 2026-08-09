import { redirect } from '@sveltejs/kit';
import { destroySession, SESSION_COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, cookies }) => {
  await destroySession(locals.sessionId, locals.user?.id ?? null, locals.clientAddress);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  redirect(303, '/login');
};

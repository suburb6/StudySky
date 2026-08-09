import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user) error(401, 'Authentication required.');
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) error(503, 'Browser push is not configured.');
  return json({ publicKey });
};

import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { authenticate, createSession, LoginBlockedError, setSessionCookie } from '$lib/server/auth';
import { formString, issueMessage } from '$lib/server/forms';
import type { Actions, PageServerLoad } from './$types';

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.')
});

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) redirect(303, '/today');
};

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const form = await request.formData();
    const result = loginSchema.safeParse({
      email: formString(form, 'email'),
      password: formString(form, 'password')
    });
    if (!result.success) {
      return fail(400, { error: issueMessage(result.error), email: formString(form, 'email') });
    }

    try {
      const user = await authenticate(
        result.data.email,
        result.data.password,
        locals.clientAddress
      );
      if (!user) {
        return fail(400, {
          error: 'Email or password is incorrect.',
          email: result.data.email
        });
      }
      const session = await createSession(
        user.id,
        locals.clientAddress,
        request.headers.get('user-agent')
      );
      setSessionCookie(cookies, session.token, session.expiresAt);
    } catch (error) {
      if (error instanceof LoginBlockedError) {
        return fail(429, {
          error: `Too many attempts. Try again after ${error.retryAt.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}.`,
          email: result.data.email
        });
      }
      throw error;
    }

    redirect(303, '/today');
  }
};

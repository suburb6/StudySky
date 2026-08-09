import type { Handle } from '@sveltejs/kit';
import { resolveSession, SESSION_COOKIE } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.clientAddress = safeClientAddress(event.getClientAddress);
  event.locals.user = null;
  event.locals.sessionId = null;

  const resolved = await resolveSession(event.cookies.get(SESSION_COOKIE));
  if (resolved) {
    event.locals.user = resolved.user;
    event.locals.sessionId = resolved.sessionId;
  }

  const response = await resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-type'
  });

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
      "connect-src 'self'"
    ].join('; ')
  );

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return response;
};

function safeClientAddress(value: () => string): string {
  try {
    return value().slice(0, 64);
  } catch {
    return 'unknown';
  }
}

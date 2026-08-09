# Accounts and secrets

StudySky has a login screen and no public registration. The first administrator is created by the
one-time setup command; administrators create member accounts in Settings.

## Bootstrap administrator

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, and `ADMIN_TIMEZONE` only while running:

```sh
docker compose --profile setup run --rm seed
```

The password must contain at least 12 characters. Use a unique random value, sign in, change it in
Settings, and remove all bootstrap administrator variables from `.env`. Compose continues to work
without them. `RESET_ADMIN_PASSWORD=true` is an explicit recovery mechanism; remove it immediately
after use.

## Member accounts

An administrator can create a member with a temporary password and storage quota in Settings.
Send the credentials through a separate secure channel and have the member change the password on
first sign-in. Each member owns separate modules, tasks, documents, shares, OCR records, and
notifications.

## Browser push destinations

StudySky accepts the standard FCM, Mozilla, Apple, and Windows browser push services by default.
If a browser uses another public push service, add its exact host (or a leading-dot domain suffix)
to the comma-separated `PUSH_ENDPOINT_ALLOWLIST` value and restart `web` and `worker`. Private, loopback,
link-local, IP-literal, non-HTTPS, and non-443 destinations remain blocked. Push authorization is
bound to the login session that enabled it, so signing out or revoking that session stops delivery.

## Required and optional secrets

- `POSTGRES_PASSWORD`: long, URL-safe, unique, and retained for the life of the database.
- `SETTINGS_ENCRYPTION_KEY`: 32 random bytes encoded as base64; required before saving an AI API
  key. Back it up securely. Losing it makes saved provider credentials unreadable.
- `VAPID_PRIVATE_KEY`: optional browser-push private key. Generate with `npm run push:keys` and
  never expose it to the browser.
- AI provider keys: optional, encrypted before storage, and scoped per administrator setting.

Never reuse the database, administrator, encryption, VAPID, or SSH secret. Do not commit `.env` or
copy secrets into GitHub Issues, Discussions, logs, or screenshots.

## Timezones

Accounts default to `UTC`. Users can set a validated IANA timezone in Settings. Scheduling,
deadlines, notifications, date filters, and calendar export use that account timezone. Changing a
timezone does not rewrite stored instants or existing timetable data.

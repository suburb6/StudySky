# Development

## Prerequisites

- Node.js 24
- npm from the locked Node distribution
- Docker with Compose v2
- PostgreSQL 18 for integration and E2E tests

## Local setup

```sh
npm ci
docker compose -f compose.dev.yml up -d postgres
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

For local Node commands, set `DATABASE_URL` to the loopback PostgreSQL instance. Never use real
credentials or personal study data in development fixtures.

## Required checks

```sh
npm run format:check
npm run lint
npm run check
npm test
npm run build
npm run test:e2e
```

Integration tests run when `TEST_DATABASE_URL` is present. The container gate in
`scripts/container-smoke.sh` verifies a blank installation, login, upload persistence, backup, and
restore. Test data must use `example.test`, generated identifiers, and synthetic module names.

## Database changes

Edit `src/lib/server/db/schema.ts`, run `npm run db:generate -- --name descriptive_name`, and review
the SQL and snapshot. Migrations must be forward-only and preserve existing data unless release
notes explicitly describe a necessary transformation. Add both migration-shape and upgrade tests.

## Design principles

- Keep the student workflow calm and compact; avoid duplicate calls to action or dashboard noise.
- Prefer shared modals, toasts, headers, spacing, and form patterns.
- Keep empty installations genuinely empty.
- Enforce ownership in server queries, never only in UI state.
- Keep optional OCR and AI paths disabled or lazy so the base installation stays lightweight.
- Use account IANA timezones for all user-facing dates and scheduling.

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.

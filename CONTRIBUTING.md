# Contributing

Thank you for improving StudySky. Keep changes small, student-focused, and safe for independent
self-hosters.

## Before coding

Use GitHub Discussions for broad ideas and support. Search existing Issues before opening a defect
or feature request. Never post credentials, private notes, database dumps, server addresses, or
screenshots containing student data. Report security problems privately through GitHub's
vulnerability reporting flow.

## Pull requests

1. Fork the repository and branch from `main`.
2. Install with `npm ci` and follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
3. Add tests for behavior and migrations. Use only synthetic `example.test` fixtures.
4. Run `npm run verify`; run E2E and container smoke tests when the affected area requires them.
5. Update documentation and `CHANGELOG.md` for user-visible changes.
6. Open a focused pull request using the template and resolve review conversations.

By submitting a contribution, you agree that it is licensed under AGPL-3.0-only. You must have the
right to contribute every included file. Do not add generated models, uploads, databases, or copied
content with unclear licensing.

## UX and architecture expectations

- Do not duplicate navigation, calls to action, summaries, or data entry.
- Prefer shared modal, toast, header, spacing, and form components.
- Keep the base image and first-run workspace lightweight and empty.
- Validate on the server and enforce user ownership in every data path.
- Treat account timezone, accessibility, keyboard use, narrow laptops, and touch as first-class.
- Preserve existing installations with forward-only, reviewed migrations.

All participants must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

# Privacy model

StudySky is software for independent self-hosting, not a hosted service. The project maintainer
cannot see or recover data from someone else's installation.

## Stored by an installation

- Account names, email addresses, password hashes, sessions, and preferences
- Modules, chapters, tasks, revision, timetable, progress, and notifications
- Uploaded originals, processed assets, OCR drafts/corrections, and sharing records
- Optional encrypted AI provider credentials
- Minimal security and audit metadata needed for login and administration

Application records live in PostgreSQL; file bytes live in the upload volume. There is no bundled
analytics, advertising, tracking pixel, or telemetry endpoint.

## Network activity

- Browsers connect to the operator's StudySky origin.
- Browser OCR model requests go to that same origin. The server may download pinned model artifacts
  from Paddle's distribution host and cache them.
- If the operator enables formula-to-LaTeX, the selected image or PDF page travels only from the
  browser to the StudySky web service and its private formula container. The container performs
  local inference, returns LaTeX, and does not persist the request image.
- If an administrator enables a custom OCR model, one prepared page is sent through the StudySky
  server to that configured service. Students see that the selected model is server-connected;
  its URL and encrypted bearer token remain administrator-only. The operator must disclose and
  assess that service's storage, logging, and network behaviour.
- Push notifications use an approved public browser push service only when the operator configures
  VAPID and a user opts in. Subscriptions are bound to the login session and stop on session
  revocation.
- An AI provider receives content only after an administrator explicitly configures and enables it.
- Container pulls, operating-system updates, and release verification contact their respective
  registries and services.

## Operator responsibilities

The person running an installation is its data controller/operator. They must choose lawful usage,
configure retention, secure the host, give members appropriate notice, handle exports/deletion, and
understand any AI or push provider they enable. The repository does not provide legal compliance
certification.

To remove an installation and its data, follow [UPGRADES.md](UPGRADES.md#complete-removal).

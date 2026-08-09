# StudySky

StudySky is a private, self-hosted workspace for students: modules, a weekly timetable, tasks,
revision, study documents, progress, and optional local OCR in one focused interface.

Every installation is independent. Running StudySky on your computer or VPS creates your own
database, accounts, and file storage. It does not connect to the maintainer's server, and there is
no public StudySky registration service.

## What it includes

- Module and chapter organisation with a lightweight Kanban board
- Monday–Sunday timetable, one-off events, iCalendar import/export, editing, and overlaps
- Tasks, revision scheduling, weekly planning, focus sessions, and notifications
- Private document uploads with tenant isolation, quotas, checksums, and backups
- Browser-based PaddleOCR/ONNX recognition for printed and handwritten notes
- Optional OCRmyPDF/Tesseract worker for searchable PDFs
- Administrator-created member accounts; no open registration
- Per-account IANA timezones and generic weighted grading by default
- Optional University of Mauritius 2026/27 grading preset

## Requirements

- Docker Desktop 4+ on Windows/macOS, or Docker Engine with Compose v2 on Linux
- At least 2 GB RAM for the base installation; more for OCR and large PDFs
- A modern Chromium, Firefox, or Safari browser
- A domain name only when exposing StudySky on a VPS

Released images support `linux/amd64` and `linux/arm64`.

## Quick start

1. Download a release or clone this repository.
2. Copy `.env.example` to `.env`.
3. Set `POSTGRES_PASSWORD`, `ORIGIN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and
   `ADMIN_TIMEZONE`. Use a long, unique bootstrap password and a valid IANA timezone such as
   `UTC`, `Europe/Paris`, or `Asia/Kathmandu`.
4. Start the database, migrations, web app, and worker:

   ```sh
   docker compose pull
   docker compose up -d postgres migrate web worker
   docker compose --profile setup run --rm seed
   ```

5. Open `ORIGIN`, sign in, and immediately change the administrator password in Settings.
6. Remove `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` from `.env`. They are bootstrap
   inputs, not runtime settings.

The first setup creates exactly one administrator and zero modules, timetable entries, tasks,
documents, or progress records.

For a source build, replace the first two commands with:

```sh
docker compose -f compose.yml -f compose.build.yml up -d --build postgres migrate web worker
docker compose -f compose.yml -f compose.build.yml --profile setup run --rm seed
```

## Documentation

- [Installation on Docker Desktop and Linux](docs/INSTALL.md)
- [VPS, DNS, Caddy, and HTTPS](docs/VPS.md)
- [Accounts and generated secrets](docs/ADMINISTRATION.md)
- [Backups and restore drills](docs/BACKUP_AND_RESTORE.md)
- [Upgrades, rollback, and removal](docs/UPGRADES.md)
- [OCR modes, privacy, and limitations](docs/OCR.md)
- [Privacy model](docs/PRIVACY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Release process and signature verification](docs/RELEASES.md)

## Privacy and security

StudySky stores application data in PostgreSQL and originals in a Docker volume. It has no
analytics or telemetry. Browser OCR runs recognition on the signed-in device after the server has
cached integrity-pinned model files; the note image is not sent to a third-party OCR API. Optional
AI providers are disabled until an administrator configures one.

Self-hosting still requires operational care: use HTTPS, keep releases current, restrict server
access, test backups, and protect the host. See [SECURITY.md](SECURITY.md) for private reporting.

## Known limitations

- OCR quality varies with handwriting, lighting, page angle, language, and device performance.
- Browser OCR is assistive: always review extracted text before relying on it.
- OCRmyPDF/Tesseract primarily targets printed text and is an optional, heavier image.
- Calendar import supports timed weekly and one-off events; complex recurrence exceptions are not
  fully modelled.
- Grading results are estimates, never an official transcript or institutional decision.
- The project is community-maintained and provides no hosted service or guaranteed support SLA.

## Community

Use GitHub Discussions for setup help and ideas, Issues for reproducible defects, and private
vulnerability reporting for security concerns. Read [SUPPORT.md](SUPPORT.md),
[CONTRIBUTING.md](CONTRIBUTING.md), and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Licence

StudySky is licensed under [AGPL-3.0-only](LICENSE). Network users must be offered the complete
corresponding source for the version they are using. Third-party software and model notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

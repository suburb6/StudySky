# Architecture

StudySky is a SvelteKit application with PostgreSQL, a background worker, and local file storage.
The release uses four application roles from the same base image: migration, one-time seed, web,
and worker. The optional OCR worker uses a separate heavier image variant.

## Runtime boundaries

- **Web:** authentication, pages, APIs, uploads, calendar export, and health endpoints.
- **Worker:** document processing, notifications, expired-session cleanup, and queued jobs through
  pg-boss.
- **PostgreSQL:** users, sessions, study records, ownership, shares, job state, and metadata.
- **Upload volume:** originals, derived assets, and the private browser-OCR model cache.
- **Browser:** PWA shell, offline queue, scanner preprocessing, PDF viewing on demand, and local
  PaddleOCR/ONNX inference.

The web and worker run as an unprivileged user with a read-only root filesystem. PostgreSQL and
uploads use separate named volumes. Caddy or another trusted reverse proxy terminates HTTPS.

## Identity and tenancy

There is no public sign-up. A bootstrap command creates one administrator; administrators create
members. Session tokens are opaque, hashed server-side, and stored in secure cookies. User-owned
queries include the authenticated user ID, and document shares are explicit records with revocation
and permission state.

Browser-local offline records carry the owning user ID and are read or replayed only for that
account. Push subscriptions are session-bound; worker delivery joins an unexpired session and uses
an approved-host policy, public-network DNS guard, and timeout.

Uploads are validated by detected content, size, quota, ownership, and checksums. Storage paths use
server-generated identifiers rather than user-controlled paths.

## Time model

Instants are stored as PostgreSQL timestamps with timezone. Date-only assessment and timetable
fields stay date-only. Each account has a validated IANA timezone; the domain layer resolves wall
times with explicit daylight-saving overlap/gap behavior. New accounts and timetable records
default to UTC. The default-changing migration does not update existing rows.

## OCR paths

Browser OCR downloads integrity-pinned Paddle model artifacts from an authenticated same-origin
endpoint and performs inference in a worker on the client. Searchable-PDF OCR is optional and runs
OCRmyPDF/Tesseract in the self-hosted background worker. Neither mode requires a third-party OCR
API.

## Release supply chain

GitHub Actions build `linux/amd64` and `linux/arm64` images from an immutable annotated tag. The
release publishes source archives, SHA-256 checksums, SPDX SBOMs, registry provenance, GitHub
attestations, and keyless Cosign signatures. Compose requires a versioned image tag. The
source-build override remains available for independent reproducible builds.

## Data recovery

`scripts/backup.sh` exports a custom PostgreSQL dump and the complete upload volume, validates both,
and writes checksums before atomic publication. `scripts/restore.sh` requires an explicit destructive
confirmation and restores both data sets. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

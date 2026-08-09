# Installation

StudySky supports released containers and local source builds. Each installation owns its own
accounts, PostgreSQL database, and upload volume.

## Docker Desktop

1. Install Docker Desktop and enable Docker Compose.
2. Download a StudySky release or clone the repository.
3. Copy `.env.example` to `.env`:

   - PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`

4. Edit `.env`. For a local install use `ORIGIN=http://localhost:3000`. Set
   `STUDYSKY_VERSION` to an immutable release such as `v0.1.0`.
5. Generate separate secrets. A URL-safe database password can be generated with
   `openssl rand -hex 32`. Generate a different administrator password. For
   `SETTINGS_ENCRYPTION_KEY`, generate exactly 32 random bytes encoded as base64.
6. Start and initialise:

   ```sh
   docker compose pull
   docker compose up -d postgres migrate web worker
   docker compose --profile setup run --rm seed
   ```

7. Open <http://localhost:3000>, change the administrator password, then remove the
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` lines from `.env`.

The setup command is idempotent. It never adds demo modules, classes, tasks, or documents.

## Linux server or workstation

Install Docker Engine and the Compose plugin from Docker's official repository. Confirm
`docker version` and `docker compose version`, then follow the same steps. Store the checkout in a
directory readable only by the administrator and protect `.env` with mode `0600`.

If the account is not in the `docker` group, prefix commands with `sudo`. Remember that Docker
group membership is effectively root access.

## Build from source

Use the source override instead of released images:

```sh
docker compose -f compose.yml -f compose.build.yml up -d --build postgres migrate web worker
docker compose -f compose.yml -f compose.build.yml --profile setup run --rm seed
```

To build the optional OCR worker locally, add `-f compose.ocr-build.yml` after
`compose.build.yml`.

## Optional searchable-PDF OCR

The base image stays small and supports browser handwriting OCR. To add OCRmyPDF and Tesseract to
the worker:

```sh
docker compose -f compose.yml -f compose.ocr.yml pull
docker compose -f compose.yml -f compose.ocr.yml up -d worker
```

Set `OCR_ENABLED=true` and the required languages in `.env`. See [OCR.md](OCR.md).

## Verify the installation

```sh
docker compose ps
curl --fail http://127.0.0.1:3000/health/ready
```

`postgres`, `web`, and `worker` should be running, and `migrate` should have exited successfully.
If setup fails, inspect `docker compose logs postgres migrate seed web worker`.

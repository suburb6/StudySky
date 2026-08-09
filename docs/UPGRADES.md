# Upgrades, rollback, and removal

## Upgrade

Read the changelog and release notes, verify the image signature, and create an off-server-ready
backup. Then change only the immutable version:

```dotenv
STUDYSKY_VERSION=v0.2.0
```

Apply it with:

```sh
docker compose pull
docker compose run --rm migrate
docker compose up -d --remove-orphans
docker compose ps
curl --fail http://127.0.0.1:3000/health/ready
```

Sign in and test persistence, uploads, and a representative workflow before deleting the previous
image or backup.

The `v0.1.0` schema binds browser push subscriptions to login sessions. An upgrade from a private
pre-release snapshot clears legacy unbound subscriptions; users can enable browser notifications
again from Settings.

## Rollback

If no incompatible migration ran, restore the previous `STUDYSKY_VERSION` and run `docker compose
up -d`. Database migrations are forward-only. When release notes say a schema change is not
backward compatible, restore the verified pre-upgrade database and uploads together before running
the earlier image.

Never attempt a partial database rollback by editing the Drizzle migration journal.

## Complete removal

First export any data you want to keep. The following removes this Compose project's containers,
network, PostgreSQL volume, and upload volume and cannot be undone:

```sh
docker compose down --volumes --remove-orphans
```

Then remove the checkout, `.env`, local backups, and any Caddy/DNS configuration you created. If
encrypted backups exist elsewhere, remove them separately according to their retention policy.

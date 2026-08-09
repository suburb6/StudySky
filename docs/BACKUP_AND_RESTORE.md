# Backups and restore drills

A usable StudySky backup contains both PostgreSQL and the upload volume. Database-only backups do
not restore documents; file-only backups do not restore ownership or metadata.

## Create a verified backup

From the deployment directory:

```sh
BACKUP_DIR=/srv/backups/studysky scripts/backup.sh
```

The script creates a restricted temporary directory, writes a custom-format PostgreSQL dump and
upload archive, validates both, records checksums, and atomically publishes the completed backup.
Set `BACKUP_RETENTION_DAYS` for local retention. For a busy installation, schedule a brief
maintenance window so document writes cannot occur between the database and file snapshots.

For encrypted archives, install `age` and set `BACKUP_AGE_RECIPIENT`. Copy the resulting artifact
off the VPS after every run. Keep the age identity somewhere else and test that it can decrypt.

## Restore drill

Practice on an isolated host or Compose project, never for the first time during an incident.
Decrypt and unpack the backup if necessary, then run:

```sh
CONFIRM_RESTORE=REPLACE_STUDYSKY_DATA scripts/restore.sh /path/to/backup-directory
```

Restore is destructive for the target installation. The script validates checksums and archive
formats before stopping application services, replaces the database and upload contents, restarts
the app, and checks PostgreSQL readiness.

After every drill, sign in and verify:

- administrator and member login;
- one module, task, and revision item;
- original and processed versions of several documents;
- storage quotas and sharing boundaries;
- `/health/ready` after a container restart.

Record the backup timestamp, application version, restore duration, and result. A backup is not
trusted until a restore drill succeeds.

## Suggested schedule

- Daily encrypted backup for active installations
- Off-server copy immediately after verification
- Monthly restore drill
- Pre-upgrade backup retained until the new release has been stable
- Periodic test of encryption keys and retention cleanup

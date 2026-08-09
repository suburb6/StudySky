#!/usr/bin/env bash
set -euo pipefail

umask 077
backup_root="${BACKUP_DIR:-./backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="${backup_root}/.${timestamp}.partial"
destination="${backup_root}/${timestamp}"

mkdir -p "${backup_root}"
if [[ -e "${partial}" || -e "${destination}" ]]; then
  echo "Backup destination already exists: ${destination}" >&2
  exit 1
fi
mkdir "${partial}"
cleanup() {
  rm -rf -- "${partial}"
}
trap cleanup EXIT

docker compose exec -T postgres pg_dump \
  --username=studysky \
  --dbname=studysky \
  --format=custom \
  --no-owner > "${partial}/database.dump"

docker compose exec -T worker tar \
  --directory=/data/uploads \
  --create \
  --file=- \
  . > "${partial}/uploads.tar"

docker compose exec -T postgres pg_restore --list < "${partial}/database.dump" > /dev/null
tar --list --file="${partial}/uploads.tar" > /dev/null

commit="$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
{
  printf 'created_at=%s\n' "${timestamp}"
  printf 'git_commit=%s\n' "${commit}"
  printf 'database_format=pg_dump_custom\n'
  printf 'uploads_format=tar\n'
} > "${partial}/manifest.txt"

(
  cd "${partial}"
  sha256sum database.dump uploads.tar manifest.txt > SHA256SUMS
)

mv -- "${partial}" "${destination}"
trap - EXIT

if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  tar --directory="${backup_root}" --create --gzip --file=- "${timestamp}" \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" \
    --output "${destination}.tar.gz.age"
  rm -rf -- "${destination}"
  destination="${destination}.tar.gz.age"
fi

if [[ "${retention_days}" =~ ^[0-9]+$ ]] && (( retention_days > 0 )); then
  find "${backup_root}" -mindepth 1 -maxdepth 1 \
    -mtime "+${retention_days}" \
    -name '20*' \
    -exec rm -rf -- {} +
fi

echo "Backup completed and verified: ${destination}"

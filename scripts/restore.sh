#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_RESTORE:-}" != "REPLACE_STUDYSKY_DATA" ]]; then
  echo "Restore is destructive. Set CONFIRM_RESTORE=REPLACE_STUDYSKY_DATA." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: CONFIRM_RESTORE=REPLACE_STUDYSKY_DATA scripts/restore.sh BACKUP_DIRECTORY" >&2
  exit 1
fi

backup="$(cd "$1" && pwd)"
if [[ ! -f "${backup}/database.dump" || ! -f "${backup}/uploads.tar" || ! -f "${backup}/SHA256SUMS" ]]; then
  echo "Backup is incomplete." >&2
  exit 1
fi

(
  cd "${backup}"
  sha256sum --check SHA256SUMS
)
docker compose exec -T postgres pg_restore --list < "${backup}/database.dump" > /dev/null
tar --list --file="${backup}/uploads.tar" > /dev/null

restore_id="$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
restore_database="studysky_restore_${restore_id}"
previous_database="studysky_previous_${restore_id}"
restore_upload_directory=".studysky_restore_${restore_id}"
services_stopped=false
original_database_renamed=false
database_swapped=false

cleanup() {
  status=$?
  set +e
  if [[ "${database_swapped}" == "true" ]]; then
    docker compose stop web worker > /dev/null
    docker compose exec -T postgres dropdb \
      --username=studysky \
      --maintenance-db=postgres \
      --if-exists \
      --force \
      studysky > /dev/null
    docker compose exec -T postgres psql \
      --username=studysky \
      --dbname=postgres \
      --command="alter database ${previous_database} rename to studysky" > /dev/null
    previous_database=''
  elif [[ "${original_database_renamed}" == "true" ]]; then
    docker compose exec -T postgres psql \
      --username=studysky \
      --dbname=postgres \
      --command="alter database ${previous_database} rename to studysky" > /dev/null
    previous_database=''
  fi
  if [[ -n "${restore_database}" ]]; then
    docker compose exec -T postgres dropdb \
      --username=studysky \
      --maintenance-db=postgres \
      --if-exists \
      --force \
      "${restore_database}" > /dev/null
  fi
  if [[ -n "${restore_upload_directory}" ]]; then
    docker compose run --rm --no-deps \
      -e RESTORE_DIRECTORY="${restore_upload_directory}" \
      worker sh -c 'rm -rf -- "/data/uploads/${RESTORE_DIRECTORY}"' > /dev/null
  fi
  if [[ "${services_stopped}" == "true" ]]; then
    docker compose up --detach web worker
  fi
  exit "${status}"
}
trap cleanup EXIT

docker compose exec -T postgres createdb \
  --username=studysky \
  --owner=studysky \
  --maintenance-db=postgres \
  "${restore_database}"
docker compose exec -T postgres pg_restore \
  --username=studysky \
  --dbname="${restore_database}" \
  --exit-on-error \
  --no-owner < "${backup}/database.dump"
docker compose exec -T postgres psql \
  --username=studysky \
  --dbname="${restore_database}" \
  --set=ON_ERROR_STOP=1 \
  --command='select 1 from users limit 0' > /dev/null

docker compose run --rm --no-deps -T \
  -e RESTORE_DIRECTORY="${restore_upload_directory}" \
  worker sh -c \
  'mkdir -p "/data/uploads/${RESTORE_DIRECTORY}" && tar --directory="/data/uploads/${RESTORE_DIRECTORY}" --extract --file=-' \
  < "${backup}/uploads.tar"

docker compose stop web worker
services_stopped=true
docker compose exec -T postgres psql \
  --username=studysky \
  --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --command="select pg_terminate_backend(pid) from pg_stat_activity where datname = 'studysky' and pid <> pg_backend_pid()" > /dev/null
docker compose exec -T postgres psql \
  --username=studysky \
  --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --command="alter database studysky rename to ${previous_database}"
original_database_renamed=true
docker compose exec -T postgres psql \
  --username=studysky \
  --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --command="alter database ${restore_database} rename to studysky"
database_swapped=true
restore_database=''

docker compose run --rm --no-deps \
  -e RESTORE_DIRECTORY="${restore_upload_directory}" \
  worker sh -c '
    find /data/uploads -mindepth 1 -maxdepth 1 ! -name "${RESTORE_DIRECTORY}" -exec rm -rf -- {} +
    find "/data/uploads/${RESTORE_DIRECTORY}" -mindepth 1 -maxdepth 1 -exec mv -- {} /data/uploads/ \;
    rmdir -- "/data/uploads/${RESTORE_DIRECTORY}"
  '
restore_upload_directory=''

docker compose up --detach web worker
docker compose exec -T postgres pg_isready --username=studysky --dbname=studysky
docker compose exec -T postgres dropdb \
  --username=studysky \
  --maintenance-db=postgres \
  --force \
  "${previous_database}"
previous_database=''
database_swapped=false
original_database_renamed=false
services_stopped=false
trap - EXIT
echo "Restore completed. Sign in and verify a sample document before accepting the restore."

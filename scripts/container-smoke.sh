#!/usr/bin/env bash
set -euo pipefail

origin="${CONTAINER_SMOKE_ORIGIN:-http://127.0.0.1:3000}"
temporary="$(mktemp -d)"
if [[ "${CONTAINER_SMOKE_RELEASE_IMAGE:-false}" == "true" ]]; then
  compose=(docker compose -f compose.yml)
  export COMPOSE_FILE="compose.yml"
else
  compose=(docker compose -f compose.yml -f compose.build.yml)
  export COMPOSE_FILE="compose.yml:compose.build.yml"
fi
trap 'rm -rf -- "${temporary}"' EXIT

wait_until_ready() {
  for _attempt in $(seq 1 60); do
    if curl --fail --silent --show-error "${origin}/health/ready" > /dev/null; then
      return 0
    fi
    sleep 2
  done
  "${compose[@]}" ps
  "${compose[@]}" logs --tail=120 postgres migrate web worker
  return 1
}

ORIGIN="${origin}" "${compose[@]}" up --detach --build
"${compose[@]}" --profile setup run --rm seed
wait_until_ready
curl --fail --silent --show-error "${origin}/health" > /dev/null

counts="$(
  "${compose[@]}" exec -T postgres psql --username=studysky --dbname=studysky --tuples-only --no-align \
    --command="select (select count(*) from users), (select count(*) from modules), (select count(*) from timetable_entries), (select count(*) from tasks), (select count(*) from documents), (select count(*) from revision_items);"
)"
if [[ "${counts}" != "1|0|0|0|0|0" ]]; then
  echo "Blank installation contained unexpected study data: ${counts}" >&2
  exit 1
fi

login_status="$(
  curl --disable --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --cookie-jar "${temporary}/cookies.txt" \
    --header "Origin: ${origin}" \
    --data-urlencode "email=${ADMIN_EMAIL}" \
    --data-urlencode "password=${ADMIN_PASSWORD}" \
    "${origin}/login"
)"
if [[ "${login_status}" != "200" && "${login_status}" != "303" ]]; then
  echo "Container smoke sign-in returned unexpected HTTP ${login_status}." >&2
  exit 1
fi
session_token="$(
  awk '$6 == "studysky_session" { print $7 }' "${temporary}/cookies.txt" | tail -n 1
)"
if [[ -z "${session_token}" ]]; then
  echo "Container smoke sign-in did not issue a session cookie." >&2
  exit 1
fi

printf '%s' \
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWP49esHSYhhVMOv0VD6NVyTBgCoJ+wfoEF/sQAAAABJRU5ErkJggg==' \
  | base64 --decode > "${temporary}/persistence.png"
curl --fail --silent --show-error \
  --header "Origin: ${origin}" \
  --cookie "studysky_session=${session_token}" \
  --form "files=@${temporary}/persistence.png;type=image/png" \
  --form "organiseLater=on" \
  "${origin}/api/uploads" > "${temporary}/upload.json"

document_id="$(
  node --input-type=module --eval "
    import fs from 'node:fs';
    const value = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    if (!value.documents?.[0]?.id) process.exit(1);
    process.stdout.write(value.documents[0].id);
  " "${temporary}/upload.json"
)"
curl --fail --silent --show-error \
  --cookie "studysky_session=${session_token}" \
  "${origin}/api/documents/${document_id}/original" \
  --output "${temporary}/before.png"

ORIGIN="${origin}" "${compose[@]}" up --detach --force-recreate web worker
wait_until_ready
curl --fail --silent --show-error \
  --cookie "studysky_session=${session_token}" \
  "${origin}/api/documents/${document_id}/original" \
  --output "${temporary}/after.png"

before_checksum="$(sha256sum "${temporary}/before.png" | cut -d ' ' -f 1)"
after_checksum="$(sha256sum "${temporary}/after.png" | cut -d ' ' -f 1)"
if [[ "${before_checksum}" != "${after_checksum}" ]]; then
  echo "Uploaded original changed after container recreation." >&2
  exit 1
fi

BACKUP_DIR="${temporary}/backups" scripts/backup.sh
backup_path="$(find "${temporary}/backups" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
CONFIRM_RESTORE=REPLACE_STUDYSKY_DATA scripts/restore.sh "${backup_path}"
wait_until_ready
curl --fail --silent --show-error \
  --cookie "studysky_session=${session_token}" \
  "${origin}/api/documents/${document_id}/original" \
  --output "${temporary}/restored.png"
restored_checksum="$(sha256sum "${temporary}/restored.png" | cut -d ' ' -f 1)"
if [[ "${before_checksum}" != "${restored_checksum}" ]]; then
  echo "Uploaded original changed after backup and restore." >&2
  exit 1
fi

echo "Blank install, health, persistence, backup, and restore checks passed."

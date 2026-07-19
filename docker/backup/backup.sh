#!/usr/bin/env bash
set -euo pipefail

# One-shot Postgres backup -> local disk (the compose file bind-mounts the
# host's ./backups into /backups). Writes a compressed custom-format dump, then
# prunes dumps older than RETENTION_DAYS.
#
#   docker compose --profile backup run --rm backup [label]
#
# label (optional, default "daily") tags the file — e.g. "premigrate" for the
# safety dump deploy/deploy.sh takes right before running migrations.
#
# Env (from .env.$DEPLOY_ENV): DATABASE_URL, BACKUP_ENV, RETENTION_DAYS,
# [BACKUP_PING_URL].
#
# NOTE: these dumps live on the same VPS disk as the database — they protect
# against bad migrations and fat-fingered deletes, not disk loss. Enable the
# VPS provider's volume snapshots for that (see DEPLOYMENT.md).

LABEL="${1:-daily}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENV:?BACKUP_ENV is required (dev|test|prod)}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

DEST="/backups/${BACKUP_ENV}"
mkdir -p "${DEST}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="rahaaon-${BACKUP_ENV}-${STAMP}-${LABEL}.dump"

echo "[backup] dumping '${BACKUP_ENV}' -> ${DEST}/${FILE}"
# -Fc: compressed custom format → supports selective/parallel pg_restore.
# Dump to a temp name and rename, so a dump that dies mid-write never sits in
# the directory looking like a valid backup.
pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" \
  > "${DEST}/${FILE}.partial"
mv "${DEST}/${FILE}.partial" "${DEST}/${FILE}"

echo "[backup] pruning dumps older than ${RETENTION_DAYS}d in ${DEST}"
find "${DEST}" -name '*.dump' -mtime "+${RETENTION_DAYS}" -delete || true
find "${DEST}" -name '*.partial' -mtime +1 -delete || true

echo "[backup] done: ${FILE}"

# Dead-man's-switch: ping a monitor (e.g. a healthchecks.io check URL) on success.
# It catches both a failed dump AND a timer that never fires. Optional; best-effort.
if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}" >/dev/null 2>&1 || true
fi

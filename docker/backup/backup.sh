#!/usr/bin/env bash
set -euo pipefail

# One-shot Postgres backup -> S3/R2 (Cloudflare R2 or any S3-compatible store).
# Streams a compressed custom-format dump directly to object storage (no local
# disk), then prunes remote dumps older than RETENTION_DAYS.
#
#   docker compose --profile backup run --rm backup [label]
#
# label (optional, default "daily") tags the file — e.g. "premigrate" for the
# safety dump deploy/deploy.sh takes right before running migrations.
#
# Env (from .env.$DEPLOY_ENV): DATABASE_URL, BACKUP_ENV, RETENTION_DAYS,
# S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, [S3_PROVIDER],
# [BACKUP_PING_URL].

LABEL="${1:-daily}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENV:?BACKUP_ENV is required (dev|test|prod)}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

if [ -z "${S3_BUCKET:-}" ] || [ -z "${S3_ENDPOINT:-}" ]; then
  # Only dev may run without object storage. For test/prod a missing S3 config is
  # a hard failure — otherwise the timer and pre-migration dumps "succeed" nightly
  # while producing zero backups, discovered only after data loss.
  if [ "$BACKUP_ENV" = "dev" ]; then
    echo "[backup] S3_BUCKET/S3_ENDPOINT not set — skipping (dev, no object storage)."
    exit 0
  fi
  echo "[backup] ERROR: S3_BUCKET/S3_ENDPOINT are required for '$BACKUP_ENV' backups." >&2
  exit 1
fi

# Configure the rclone "r2" remote from env (shared with the manual
# list/restore commands in DEPLOYMENT.md).
. /usr/local/bin/rclone-env.sh

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="r2:${S3_BUCKET}/backups/${BACKUP_ENV}"
FILE="rahaaon-${BACKUP_ENV}-${STAMP}-${LABEL}.dump"

echo "[backup] dumping '${BACKUP_ENV}' -> ${DEST}/${FILE}"
# -Fc: compressed custom format → supports selective/parallel pg_restore.
pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL}" \
  | rclone rcat "${DEST}/${FILE}"

echo "[backup] pruning dumps older than ${RETENTION_DAYS}d in ${DEST}"
rclone delete --min-age "${RETENTION_DAYS}d" "${DEST}" || true

echo "[backup] done: ${FILE}"

# Dead-man's-switch: ping a monitor (e.g. a healthchecks.io check URL) on success.
# It catches both a failed dump AND a timer that never fires. Optional; best-effort.
if [ -n "${BACKUP_PING_URL:-}" ] && command -v curl >/dev/null 2>&1; then
  curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}" >/dev/null 2>&1 || true
fi

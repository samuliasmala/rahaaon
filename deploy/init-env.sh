#!/usr/bin/env bash
# Create .env.<env> for a deployed stack (run on the VPS) from .env.prod.example,
# generating secrets and filling the per-env values the template documents.
# Never overwrites an existing file. Usage: deploy/init-env.sh dev|test|prod
# (or: make env-deploy ENV=...).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-}"
case "$ENV" in
  dev)  DOMAIN=dev.rahaaon.asmala.fi;  WEB_PORT=8091 ;;
  test) DOMAIN=test.rahaaon.asmala.fi; WEB_PORT=8092 ;;
  prod) DOMAIN=rahaaon.asmala.fi;      WEB_PORT=8090 ;;
  *) echo "usage: $0 dev|test|prod" >&2; exit 1 ;;
esac

TARGET=".env.$ENV"
if [ -f "$TARGET" ]; then
  echo "$TARGET already exists — leaving it untouched"
  exit 0
fi

# hex, not base64: the password is embedded in DATABASE_URL and must be URL-safe
PG_PASSWORD="$(openssl rand -hex 24)"

cp .env.prod.example "$TARGET"
sed -i \
  -e "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" \
  -e "s|^API_URL=.*|API_URL=https://$DOMAIN|" \
  -e "s|^WEB_PORT=.*|WEB_PORT=$WEB_PORT|" \
  -e "s|^BACKUP_ENV=.*|BACKUP_ENV=$ENV|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASSWORD|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://rahaaon:$PG_PASSWORD@db:5432/rahaaon|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" \
  -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$(openssl rand -base64 18)|" \
  "$TARGET"

echo "Created $TARGET with generated secrets."
echo "Optional manual fill: BACKUP_PING_URL (dead-man's-switch for backups)."

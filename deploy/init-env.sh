#!/usr/bin/env bash
# Create .env.<env> for a deployed stack (run on the VPS) from .env.prod.example,
# generating secrets and filling the per-env values the template documents.
# Never overwrites an existing file. Usage: deploy/init-env.sh dev|test|prod
# (or: make env ENV=...).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV="${1:-}"
case "$ENV" in
  dev)  DOMAIN=dev.rahaa-on.fi;  WEB_PORT=8091; ;;
  test) DOMAIN=test.rahaa-on.fi; WEB_PORT=8092; ;;
  prod) DOMAIN=rahaa-on.fi;      WEB_PORT=8090 ;;
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

if [ "$ENV" = prod ]; then
  # Editorial push notifications run in prod only. On the public ntfy.sh the
  # topic name doubles as the shared secret, so generate it rather than let
  # anyone pick something guessable; subscribe to it in the ntfy app.
  sed -i -e "s|^NTFY_TOPIC=.*|NTFY_TOPIC=rahaaon-$(openssl rand -hex 12)|" "$TARGET"
fi

if [ "$ENV" != prod ]; then
  # dev/test use the bundled versitygw service (profile "s3") instead of R2
  sed -i \
    -e "s|^S3_ENDPOINT=.*|S3_ENDPOINT=http://s3:9000|" \
    -e "s|^S3_ACCESS_KEY_ID=.*|S3_ACCESS_KEY_ID=rahaaon-$ENV|" \
    -e "s|^S3_SECRET_ACCESS_KEY=.*|S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)|" \
    -e "s|^S3_PROVIDER=.*|S3_PROVIDER=Other|" \
    "$TARGET"
fi

echo "Created $TARGET with generated secrets."
if [ "$ENV" = prod ]; then
  echo "Fill in manually: S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (Cloudflare R2)."
  echo "Subscribe to the generated NTFY_TOPIC in the ntfy app to get queue notifications:"
  grep '^NTFY_TOPIC=' "$TARGET"
fi
echo "Optional manual fill: BACKUP_PING_URL (dead-man's-switch for backups)."

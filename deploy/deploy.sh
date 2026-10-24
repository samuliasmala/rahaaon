#!/usr/bin/env bash
set -euo pipefail

# Runs ON THE VPS (invoked by .github/workflows/deploy.yml over SSH, or by hand).
# Syncs infra files to the deployed ref, pulls the CI-built images from GHCR, and
# brings up the target stack. For test/prod it takes a pre-migration safety dump
# first. Idempotent — safe to re-run.
#
# Required env (the workflow sets these; export them yourself for a manual run):
#   DEPLOY_ENV   dev | test | prod       (selects .env.$DEPLOY_ENV + project name)
#   DEPLOY_REF   git sha (dev) or tag vX.Y.Z (test/prod) to check out
#   IMAGE_TAG    GHCR image tag to run    (sha-xxxx | vX.Y.Z)
#   REGISTRY     e.g. ghcr.io/samuliasmala
#   GHCR_USER / GHCR_TOKEN   credentials for `docker login ghcr.io`
# Optional: DEPLOY_DIR (default /srv/rahaaon)

main() {
  : "${DEPLOY_ENV:?}"; : "${DEPLOY_REF:?}"; : "${IMAGE_TAG:?}"; : "${REGISTRY:?}"
  case "$DEPLOY_ENV" in dev|test|prod) ;; *) echo "bad DEPLOY_ENV: $DEPLOY_ENV" >&2; exit 1 ;; esac

  local dir="${DEPLOY_DIR:-/srv/rahaaon}"
  cd "$dir"

  # Serialize deploys across environments: all stacks share this one checkout,
  # and the `git checkout --force` below (plus every compose invocation reading
  # the infra files) would race a concurrent deploy of another env. GitHub-side
  # queues are per-environment (deploy.yml concurrency), so cross-env mutual
  # exclusion lives here. The fd stays open (and the lock held) until exit.
  exec 9>"/tmp/rahaaon-deploy.lock"
  flock -w 900 9 || { echo "another deploy has held the lock for >15 min — aborting" >&2; exit 1; }

  # Sync infra files (compose, this script, docker/) to the deployed ref. main()
  # is fully parsed before we run, so replacing files on disk now is safe.
  git fetch --all --tags --prune --force
  git checkout --force "$DEPLOY_REF"

  local env_file=".env.$DEPLOY_ENV"
  [ -f "$env_file" ] || { echo "missing $dir/$env_file" >&2; exit 1; }

  if [ -n "${GHCR_TOKEN:-}" ]; then
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-x}" --password-stdin
  fi

  export DEPLOY_ENV IMAGE_TAG REGISTRY
  local dc=(docker compose -p "rahaaon-$DEPLOY_ENV" --env-file "$env_file" -f docker-compose.prod.yml)

  # versitygw (self-hosted S3) runs in the dev/test stacks only; prod points S3_* at R2.
  # Empty for prod so the s3 profile is never activated there.
  local storage_profile=()
  [ "$DEPLOY_ENV" != "prod" ] && storage_profile=(--profile s3)

  echo "==> pulling images ($REGISTRY/*:$IMAGE_TAG)"
  # --profile backup: backup is profile-gated so a plain pull skips it, and its
  # :stable tag MOVES — nothing else re-pulls it (compose run only pulls a
  # missing image), so without this the VPS runs a stale backup image forever.
  "${dc[@]}" --profile backup pull db migrate api web backup

  # Bring s3 up before the pre-migration dump so the test backup — which targets
  # it (S3_ENDPOINT=http://s3:9000) — has a live endpoint. dev skips backups;
  # prod has no s3.
  if [ "${#storage_profile[@]}" -ne 0 ]; then
    # Fail fast on blank/short S3 root creds: an empty root account would let the
    # gateway start wide open instead of failing.
    # Read from the env file (deploy.sh doesn't source it; compose does).
    local s3_key s3_secret
    s3_key="$(grep -E '^S3_ACCESS_KEY_ID=' "$env_file" | tail -1 | cut -d= -f2-)"
    s3_secret="$(grep -E '^S3_SECRET_ACCESS_KEY=' "$env_file" | tail -1 | cut -d= -f2-)"
    if [ "${#s3_key}" -lt 3 ] || [ "${#s3_secret}" -lt 8 ]; then
      echo "S3 storage needs S3_ACCESS_KEY_ID (>=3 chars) and S3_SECRET_ACCESS_KEY (>=8 chars)" >&2
      echo "set in $env_file — see the object-storage block in .env.prod.example." >&2
      exit 1
    fi

    echo "==> starting S3 object storage (versitygw)"
    "${dc[@]}" "${storage_profile[@]}" up -d --wait --wait-timeout 60 s3 || {
      echo "S3 storage failed to start — aborting deploy" >&2; exit 1;
    }
  fi

  # Pre-migration safety dump for test/prod (db from the previous deploy is still
  # up, so this captures the pre-migration state). Skipped on the very first
  # deploy of a stack (no db container yet — nothing to dump).
  if [ "$DEPLOY_ENV" != "dev" ] && "${dc[@]}" ps --status running db --quiet | grep -q .; then
    echo "==> pre-migration backup"
    "${dc[@]}" --profile backup run --rm backup premigrate || {
      echo "pre-migration backup failed — aborting deploy" >&2; exit 1;
    }
  fi

  echo "==> up (migrate one-shot, then api/web)"
  # --wait blocks until services are healthy and returns non-zero if any fail to
  # become healthy within the timeout, so a boot-broken image fails the deploy
  # (and the workflow) instead of reporting green while the API crash-loops.
  # storage_profile keeps s3 in the active set so --remove-orphans won't reap it.
  "${dc[@]}" "${storage_profile[@]}" up -d --remove-orphans --wait --wait-timeout 120 || {
    # Surface the usual culprit in the workflow log — a failed migration is
    # otherwise invisible without SSHing in.
    echo "==> up failed — migrate logs:" >&2
    "${dc[@]}" logs --no-color --tail 50 migrate >&2 || true
    exit 1
  }

  # -a is needed: superseded images keep their sha-/version tags, so the default
  # dangling-only prune never reclaims them and the shared VPS disk slowly
  # fills. Images used by ANY container (all stacks, running or stopped) are
  # kept; until=168h leaves a week of images for instant rollback.
  docker image prune -af --filter "until=168h" >/dev/null || true
  echo "==> deployed $DEPLOY_ENV @ $IMAGE_TAG"
}

main "$@"

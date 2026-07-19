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

  echo "==> pulling images ($REGISTRY/*:$IMAGE_TAG)"
  # --profile backup: backup is profile-gated so a plain pull skips it, and its
  # :stable tag MOVES — nothing else re-pulls it (compose run only pulls a
  # missing image), so without this the VPS runs a stale backup image forever.
  "${dc[@]}" --profile backup pull db migrate api web backup

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
  "${dc[@]}" up -d --remove-orphans --wait --wait-timeout 120 || {
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

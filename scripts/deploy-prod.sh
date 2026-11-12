#!/usr/bin/env bash
set -euo pipefail

# usage: pnpm deploy:prod [vX.Y.Z]   (defaults to the newest release tag)

version="${1:-$(git tag --list 'v*.*.*' --sort=-v:refname | head -n1)}"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: version must look like vX.Y.Z (got '$version')" >&2; exit 1; }

test_run=$(gh run list --workflow deploy.yml --event push --branch "$version" --limit 1 \
  --json databaseId,status,conclusion --jq '.[0] // empty | "\(.databaseId) \(.status) \(.conclusion)"')
[[ -n "$test_run" ]] || { echo "error: no test deploy found for $version; is the tag pushed?" >&2; exit 1; }
read -r test_run_id status conclusion <<<"$test_run"

if [[ "$status" != completed ]]; then
  echo "Test deploy of $version is still running, waiting for it…"
  gh run watch "$test_run_id" --exit-status
elif [[ "$conclusion" != success ]]; then
  echo "error: test deploy of $version concluded '$conclusion'; refusing to deploy to prod." >&2
  exit 1
fi

latest_prod_run() {
  gh run list --workflow deploy.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
}

previous_run_id=$(latest_prod_run)
echo "Deploying $version to prod…"
gh workflow run deploy.yml -f version="$version"

# The dispatch API doesn't reliably return the run it created, so wait for a new one to appear.
run_id="$previous_run_id"
for _ in {1..15}; do
  sleep 2
  run_id=$(latest_prod_run)
  [[ "$run_id" != "$previous_run_id" ]] && break
done
[[ "$run_id" != "$previous_run_id" ]] || { echo "error: dispatched, but the run never showed up; check: gh run list --workflow deploy.yml" >&2; exit 1; }

gh run watch "$run_id" --exit-status
echo "Deployed $version to prod."

#!/usr/bin/env bash
set -euo pipefail

# Bump every package.json (root + all workspace packages) to the same version,
# in a single commit + one annotated tag.
#
# usage: pnpm release <version|patch|minor|major> [--push]
#   pnpm release minor          # bump, commit, tag (push manually)
#   pnpm release 0.2.0 --push   # bump, commit, tag, then git push --follow-tags

bump=""
push=false
for arg in "$@"; do
  case "$arg" in
    --push) push=true ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *) bump="$arg" ;;
  esac
done
[[ -n "$bump" ]] || { echo "usage: pnpm release <version|patch|minor|major> [--push]" >&2; exit 1; }

# Refuse to release on top of unrelated uncommitted work.
[[ -z "$(git status --porcelain)" ]] || { echo "error: working tree not clean; commit or stash first." >&2; exit 1; }

# Bump every package.json (incl. root) with no git side effects. --allow-same-version
# keeps them in lockstep even if one has drifted.
pnpm -r --include-workspace-root exec npm version "$bump" --no-git-tag-version --allow-same-version

# Resolve the real version (handles the patch/minor/major keywords).
V=$(node -p "require('./package.json').version")

# Commit only the version files, never a stray `git add .`.
git commit -q -m "chore(release): v$V" package.json apps/*/package.json
git tag -a "v$V" -m "v$V"   # annotated, so `git push --follow-tags` will push it
echo "Created commit + annotated tag v$V"

if $push; then
  git push --follow-tags
  echo "Pushed."
else
  echo "Push with: git push --follow-tags"
fi

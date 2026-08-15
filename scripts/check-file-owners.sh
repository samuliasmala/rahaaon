#!/usr/bin/env bash
set -euo pipefail

# Fail when a file in the repo belongs to someone other than the user running
# this.
#
# The dev stack bind-mounts the repo into a container, so whatever that
# container writes lands on the host owned by the container's user. While the
# image ran as root that meant files this user cannot overwrite, and the
# breakage always surfaced far from the cause: a root-owned .husky/_/h failed
# every `pnpm install` with EACCES, root-owned drizzle migrations and orval
# output would fail any checkout or codegen run that had to rewrite them.
# docker/dev.Dockerfile now runs as uid 1000, so this is the tripwire for
# whatever gets it wrong next — a new container, a sudo command, a stray tool.
#
# usage: scripts/check-file-owners.sh
#   Also wired into .husky/pre-commit (a commit is a fine moment to hear about
#   it) and `make doctor`.

me=$(id -un)

# node_modules is skipped as a matter of cost, not principle: pnpm's store is a
# container-managed volume in the dev stack, so nothing there is bind-mounted
# back. .git is not skipped — a root-owned .git/config breaks `git config`
# exactly the way a root-owned hook file breaks installs.
mapfile -t offenders < <(find . -name node_modules -prune -o ! -user "$me" -print | sort)

if [[ ${#offenders[@]} -eq 0 ]]; then
  echo "file owners ok — everything under $(pwd) belongs to $me"
  exit 0
fi

# Tracked files are listed first: those are the ones that break git operations,
# not just a rebuild.
tracked=()
untracked=()
for path in "${offenders[@]}"; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    tracked+=("$path")
  else
    untracked+=("$path")
  fi
done

echo "error: ${#offenders[@]} path(s) under $(pwd) are not owned by $me:" >&2
for path in "${tracked[@]}"; do
  echo "  [tracked]   $path ($(stat -c '%U' "$path"))" >&2
done
for path in "${untracked[@]}"; do
  echo "  [untracked] $path ($(stat -c '%U' "$path"))" >&2
done
cat >&2 <<EOF

Most likely something wrote them from inside the dev container. Take ownership
of what is tracked, and delete what is only a cache:

  sudo chown -R $me: <tracked paths above>
  sudo rm -rf .turbo/cache .pnpm-store   # regenerated on the next run

Then check the container: docker/dev.Dockerfile is meant to run as \`node\`
(uid 1000), and \`docker compose ... exec\` inherits that. A \`-u 0\` somewhere,
or an image built before that change, puts root back in the bind mount.
EOF

exit 1

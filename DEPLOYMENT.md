# Deployment

Three environments on one Ubuntu VPS (shared with the vesi stacks), each an
isolated Docker Compose stack (own Postgres/volumes), fronted by host **Caddy**
for TLS. Images are built once by CI, pushed to **GHCR**, and pulled on the VPS.

| Env  | Trigger                             | Domain                    | web port | project name   |
| ---- | ----------------------------------- | ------------------------- | -------- | -------------- |
| dev  | push to `main` (no CI gate)         | `dev.rahaaon.samcode.fi`  | 8091     | `rahaaon-dev`  |
| test | push tag `vX.Y.Z`                   | `test.rahaaon.samcode.fi` | 8092     | `rahaaon-test` |
| prod | **manual** (Actions → Run workflow) | `rahaaon.samcode.fi`      | 8090     | `rahaaon-prod` |

Prod reuses the **exact image** built for the `vX.Y.Z` tag that ran on test — no
rebuild — so what you approve is byte-identical to what you tested.

> **Note:** the dev-machine publish at `rahaaon.asmala.fi` (host Caddy → local
> Vite `:5174`) is a separate setup on a different machine; it coexists with
> these stacks and is unaffected by deploys.

---

## One-time: GitHub

1. **Branch protection** on `main`: require the `CI` workflow to pass before
   merge. (Deploys trust that main is green; tags are cut from main.)
2. **Environments** (Settings → Environments): create `dev`, `test`, `prod`.
   On `prod` add yourself as a **required reviewer** → the manual prod deploy
   pauses for an approval click.
3. **Deploy key** (Settings → Deploy keys): add a **read-only** key so the VPS
   `deploy` user can `git fetch/checkout` the repo on every deploy. The vesi
   deploy key won't work here — generate a separate one on the VPS (see below)
   and paste the public half. (Skip if the repo is public.) The GHCR image pull
   uses the forwarded `GITHUB_TOKEN`; only the git sync of infra files needs
   this key.
4. **Variables** (Settings → Secrets and variables → Actions → _Variables_) —
   non-sensitive config, repo-level (or per-environment):
   - `VPS_HOST` — SSH host/IP of the VPS.
   - `VPS_USER` — the dedicated deploy user, i.e. **`deploy`** (see VPS setup).
   - `DEPLOY_DIR` — optional, defaults to `/srv/rahaaon`.
5. **Secrets** (same page → _Secrets_) — sensitive only:
   - `VPS_SSH_KEY` — private key whose public half is in `deploy`'s
     `~/.ssh/authorized_keys`.
   - GHCR auth uses the built-in `GITHUB_TOKEN` (no PAT needed).

## One-time: VPS

The VPS already runs the vesi stacks, so Docker, Caddy and the non-root
**`deploy`** user exist. What rahaaon adds:

**As root / sudo:**

```bash
sudo mkdir -p /srv/rahaaon && sudo chown deploy:deploy /srv/rahaaon
```

**As the deploy user** (`sudo -iu deploy`) — GitHub access, clone, config:

```bash
# Outbound key so `deploy` can git fetch/checkout THIS repo (GitHub allows a
# deploy key on only one repo, so vesi's can't be reused). Add the PUBLIC half
# to GitHub → Settings → Deploy keys, read-only. Skip if the repo is public.
ssh-keygen -t ed25519 -N "" -f ~/.ssh/github_rahaaon -C rahaaon-vps-deploy
printf 'Host github.com-rahaaon\n  HostName github.com\n  IdentityFile ~/.ssh/github_rahaaon\n  IdentitiesOnly yes\n' >> ~/.ssh/config
cat ~/.ssh/github_rahaaon.pub                        # <- paste into GitHub Deploy keys

# Clone via the host alias (infra files only; images come from GHCR)
git clone git@github.com-rahaaon:samuliasmala/rahaaon.git /srv/rahaaon
cd /srv/rahaaon

# Env files — one per stack (gitignored). deploy/init-env.sh fills the per-env
# values (domain, WEB_PORT, BACKUP_ENV, MinIO vs R2) and generates the DB
# password + secrets; then fill in what it lists as manual (prod R2 creds).
make env-deploy ENV=dev && make env-deploy ENV=test && make env-deploy ENV=prod
$EDITOR .env.prod
```

**Back as root / sudo — host services:**

```bash
# Merge the rahaaon blocks into the live Caddyfile (it is a superset serving
# vesi + other sites; deploy/Caddyfile is the rahaaon-only source of truth).
$EDITOR /etc/caddy/Caddyfile      # add the blocks from deploy/Caddyfile
sudo systemctl reload caddy

# Backups: daily timers for prod + test (units run as the deploy user)
sudo cp /srv/rahaaon/deploy/rahaaon-backup@.service /srv/rahaaon/deploy/rahaaon-backup@.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rahaaon-backup@prod.timer rahaaon-backup@test.timer
```

Point DNS `A`/`AAAA` records for the three (sub)domains at the VPS IP. Caddy
fetches certs on first request.

**Seed the editorial user** after a stack's first deploy (migrations have run;
`SEED_ADMIN_PASSWORD` comes from the env file):

```bash
docker compose -p rahaaon-dev --env-file .env.dev -f docker-compose.prod.yml \
  run --rm api node dist/db/seed.js
```

---

## Deploying

- **dev** — merge to `main`. Deploy builds `sha-<short>`, pushes, and updates
  the dev stack **immediately** — it does not wait for the CI suite (CI still
  runs in parallel for the record). dev is a throwaway preview; a broken build
  still fails the deploy. test/prod stay gated on CI.
- **test** — tag a green commit and push:
  ```bash
  git tag v0.2.0 && git push origin v0.2.0
  ```
- **prod** — GitHub → Actions → **Deploy** → _Run workflow_, enter `v0.2.0`,
  approve the environment prompt. Same image `v0.2.0` is pulled and run.

Migrations apply automatically: the compose `migrate` one-shot runs before `api`
starts. test/prod also take a **pre-migration dump** (`deploy/deploy.sh`) so a
bad migration is recoverable.

Manual deploy / rollback from the VPS (rollback = redeploy an older tag):

```bash
cd /srv/rahaaon
DEPLOY_ENV=prod DEPLOY_REF=v0.1.0 IMAGE_TAG=v0.1.0 REGISTRY=ghcr.io/samuliasmala \
  ./deploy/deploy.sh
```

---

## Backups

Daily `pg_dump` (compressed custom format) streamed straight to object storage
by the `backup` container, invoked by the systemd timers. prod targets
**Cloudflare R2**; dev/test target the stack's bundled **MinIO** (profile
`minio`, console published on `127.0.0.1:${MINIO_CONSOLE_PORT}` — dev 9093 /
test 9094). Layout in the bucket:
`backups/<env>/rahaaon-<env>-<UTC-timestamp>-<label>.dump` (`label` = `daily`
or `premigrate`). Kept `RETENTION_DAYS` (default 30); older dumps auto-pruned.

Run one on demand:

```bash
docker compose -p rahaaon-prod --env-file .env.prod -f docker-compose.prod.yml \
  --profile backup run --rm backup daily
```

**Restore runbook.** Restoring is destructive, so follow the order — don't pipe
into a live db:

```bash
DC="docker compose -p rahaaon-prod --env-file .env.prod -f docker-compose.prod.yml"

# 1. List available dumps and pick one. (rclone-env.sh maps S3_* -> the rclone
#    "r2" remote; a bare `--entrypoint rclone` would not see the credentials.)
$DC --profile backup run --rm --entrypoint sh backup -c \
  '. /usr/local/bin/rclone-env.sh && rclone ls "r2:$S3_BUCKET/backups/prod"'

# 2. Stop the app so nothing writes during the restore. Leave db up.
#    `migrate` is a one-shot, already exited.
$DC stop api web

# 3. Restore. --clean drops/recreates objects first.
$DC --profile backup run --rm --entrypoint sh backup -c \
  '. /usr/local/bin/rclone-env.sh && rclone cat "r2:$S3_BUCKET/backups/prod/<FILE>.dump" | pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL"'

# 4. Bring the app back up (waits for healthy).
$DC up -d --wait
```

Also enable your **VPS provider's daily volume snapshots** as cheap whole-disk
insurance — complementary to the logical dumps, zero code. **Rehearse this
runbook once against the test stack** and note the measured restore time — an
untested restore is a hypothesis, not a capability.

## Monitoring

1. **Uptime check** on `https://<host>/api/health/ready` (readiness — checks the
   DB), e.g. a free healthchecks.io / UptimeRobot monitor. Alerts on downtime.
2. **Backup dead-man's-switch**: set `BACKUP_PING_URL` to a healthchecks.io check
   URL; `backup.sh` pings it on success, so a failed dump _or_ a timer that never
   fires is noticed.

## Scaling — single-server assumption

Each stack runs **one `api` replica**. Some state lives in that process's
memory, so **do not raise the `api` replica count or add a second app host
without first moving that state to a shared store** — under multiple replicas
each of these silently misbehaves:

- **Per-IP rate limits** (`api/src/middleware/rate-limit.ts`) — a separate
  bucket map per process, so N replicas raise every effective limit ~N×.
- **better-auth's login limiter** (`api/src/auth/auth.ts`) — storage defaults to
  in-memory (no `secondaryStorage` configured), same ~N× dilution of the
  brute-force cap.
- **Page-preview cache** (`api/src/lib/page-preview.ts`) — per process; a submit
  that lands on a different replica than the preview just re-fetches the page
  (no correctness issue, only a redundant outbound fetch).
- **Archive per-drain batch size** (`api/src/lib/article-archive.ts`) —
  `BATCH_SIZE` bounds concurrent outbound archive fetches _per process_, so N
  replicas allow up to N× that. Correctness is fine (the worklist is DB-backed
  and claims rows with `FOR UPDATE SKIP LOCKED`); only the outbound-fetch
  ceiling multiplies.

Scale-out path: back the limiters and the preview cache with Redis (or
Postgres). Nothing else needs restructuring.

Already scale-out-safe: **sessions** live in Postgres (the `session` table), and
**article archiving** is a Postgres worklist claimed with `SKIP LOCKED` +
per-row leases — multiple workers coordinate correctly and a restart resumes
outstanding rows rather than losing them.

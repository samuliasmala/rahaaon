# Environment management for the local dev stack AND the deployed stacks.
#
#   ENV=local (default)  Local dev stack: repo bind-mounted, Vite + tsx watch
#                        (docker-compose.yml + docker-compose.dev.yml). Runs on
#                        your machine. DB one-offs run the TS source via pnpm.
#   ENV=dev|test|prod    A deployed stack (docker-compose.prod.yml): pulled
#                        image, one Docker project per env (rahaaon-<env>), env
#                        from .env.<env>. Run these ON THE VPS, where the stack
#                        and env file live. DB one-offs run the built dist/.
#
# Examples:
#   make up                               # start the local dev stack
#   make logs ENV=prod                    # follow prod api logs (on the VPS)
#   make set-admin-password ENV=test      # rotate the test admin password
#   make set-admin-password ENV=prod ARGS=--revoke-sessions
#   WEB_PORT=5175 API_PORT=3002 make up   # override host ports (local only)

ENV ?= local
VALID_ENVS := local dev test prod
ifeq ($(filter $(ENV),$(VALID_ENVS)),)
  $(error ENV must be one of: $(VALID_ENVS) (got '$(ENV)'))
endif

# Version footer for the in-container dev server — the dev image has no git, so
# compute `git describe` + the commit time here and hand them to compose
# (docker-compose.dev.yml). The values are frozen into the container's
# environment: `make up` recreates the container when they change; `make restart`
# reuses the old ones. (Deployed images bake their own version; harmless there.)
export GIT_DESCRIBE := $(shell git describe --tags --always --dirty 2>/dev/null)
export GIT_COMMIT_TIME := $(shell git log -1 --format=%cI 2>/dev/null)

ifeq ($(ENV),local)
  COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml
  APP_SVC := app
  # DB one-offs run the TS source via pnpm inside the running app container.
  db_run = $(COMPOSE) exec $(APP_SVC) pnpm db:$(1) $(if $(strip $(ARGS)),-- $(ARGS),)
else
  # docker-compose.prod.yml needs IMAGE_TAG (normally exported by
  # deploy/deploy.sh) or `run --rm` one-offs try to pull :latest, which is
  # never pushed. Derive it from the running api container of this env's
  # stack; pass IMAGE_TAG=... explicitly to override (or if nothing runs yet).
  ifndef IMAGE_TAG
    IMAGE_TAG := $(shell docker ps \
      --filter label=com.docker.compose.project=rahaaon-$(ENV) \
      --filter label=com.docker.compose.service=api \
      --format '{{.Image}}' | head -1 | sed 's/.*://')
  endif
  export IMAGE_TAG
  # docker-compose.prod.yml resolves env_file from ${DEPLOY_ENV:-prod}; deploy.sh
  # exports it, but make-run one-offs (migrate, seed, …) must too — otherwise the
  # containers they create load .env.prod regardless of ENV.
  export DEPLOY_ENV := $(ENV)
  COMPOSE := docker compose -p rahaaon-$(ENV) --env-file .env.$(ENV) -f docker-compose.prod.yml
  APP_SVC := api
  # DB one-offs run the built script in a throwaway container (no source in the image).
  db_run = $(COMPOSE) run --rm $(APP_SVC) node dist/db/$(1).js $(ARGS)
endif

.DEFAULT_GOAL := help

.PHONY: help env up down restart recreate build logs ps shell migrate seed set-admin-password set-db-password psql clean \
	backup-now backup-list backup-status backup-install

help: ## List targets. Append ENV=dev|test|prod to target a deployed stack (default: local)
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

env: ## Create this stack's env file with generated secrets (.env local, .env.$(ENV) deployed; no-op if it exists)
ifeq ($(ENV),local)
	@if [ -f .env ]; then \
		echo ".env already exists — leaving it untouched"; \
	else \
		cp .env.example .env; \
		sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" .env; \
		echo "Created .env from .env.example with a generated AUTH_SECRET — review URLs/ports if needed."; \
	fi
else
	@./deploy/init-env.sh $(ENV)
endif

up: ## Start the dev stack (app + db), detached [local only]
	@[ "$(ENV)" = local ] || { echo "up is local-only — deployed stacks are brought up by the deploy pipeline (deploy/deploy.sh / CI), not make."; exit 1; }
	$(COMPOSE) up -d

down: ## Stop the dev stack (volumes are kept) [local only]
	@[ "$(ENV)" = local ] || { echo "down is local-only — stopping a deployed stack is an outage; use the deploy pipeline."; exit 1; }
	$(COMPOSE) down

restart: ## Restart the app/api service (db untouched)
	$(COMPOSE) restart $(APP_SVC)

# `restart` reuses the container and its baked-in env; only recreating re-reads
# the env file. Mirrors deploy.sh's up flags, on the image already running
# (IMAGE_TAG is derived from the live api container above).
recreate: ## Recreate migrate+api so they re-read .env.$(ENV) after env-file edits (brief api restart) [deployed only]
	@[ "$(ENV)" != local ] || { echo "recreate is deployed-only — the local stack re-reads .env on make down && make up."; exit 1; }
	$(COMPOSE) up -d --force-recreate --wait --wait-timeout 120 migrate api

build: ## Rebuild the dev image (only needed when dev.Dockerfile changes) [local only]
	@[ "$(ENV)" = local ] || { echo "build is local-only — deployed stacks run pulled images built by CI."; exit 1; }
	$(COMPOSE) build

logs: ## Follow app/api logs; SERVICE=db (or several: SERVICE="api db") for other services, SERVICE=all for the whole stack
	$(COMPOSE) logs -f $(if $(filter all,$(SERVICE)),,$(or $(SERVICE),$(APP_SVC)))

ps: ## Show stack status
	$(COMPOSE) ps

shell: ## Open a shell in the app/api container
	$(COMPOSE) exec $(APP_SVC) bash

migrate: ## Run database migrations
	$(call db_run,migrate)

seed: ## Seed the database — WIPES content, so refused on prod
	@[ "$(ENV)" != prod ] || { echo "refusing to seed prod — the seed WIPES all content tables (allowed: local/dev/test)."; exit 1; }
	$(call db_run,seed)

set-admin-password: ## Ensure the admin user exists with the password from SEED_ADMIN_PASSWORD (non-destructive; ARGS=--revoke-sessions to sign out too)
	$(call db_run,set-admin-password)

# The postgres image applies POSTGRES_PASSWORD only when the data volume is
# first initialized; regenerating .env.<env> afterwards leaves the volume on the
# old password and every TCP client fails with 28P01. This re-syncs the stored
# password to the env file over the container's local socket (no password needed).
# SQL goes via stdin, not -c: psql only interpolates the :'pw' variable (which
# quote-escapes the password) when reading input, never in -c strings.
set-db-password: ## Sync Postgres's stored password to POSTGRES_PASSWORD in .env.$(ENV) (fixes auth failures after env-file regen)
	@[ "$(ENV)" != local ] || { echo "set-db-password is deployed-only — the local stack's db password is hardcoded in docker-compose.yml."; exit 1; }
	@PW=$$(grep -m1 '^POSTGRES_PASSWORD=' .env.$(ENV) | cut -d= -f2-); \
	[ -n "$$PW" ] || { echo "POSTGRES_PASSWORD not set in .env.$(ENV)"; exit 1; }; \
	$(COMPOSE) exec -T -e NEW_PW="$$PW" db sh -c \
		'echo "ALTER USER \"$$POSTGRES_USER\" WITH PASSWORD :'\''pw'\''" | psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v pw="$$NEW_PW" -v ON_ERROR_STOP=1 -f -'
	@echo "db password now matches .env.$(ENV) — if api/migrate containers predate the env change, run 'make recreate ENV=$(ENV)' so DATABASE_URL matches too."

psql: ## Open psql against the stack's database
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

clean: ## Stop the stack and DELETE all volumes (db data, node_modules) [local only]
	@[ "$(ENV)" = local ] || { echo "clean is local-only — it runs 'down -v' and DELETES volumes (DB data). Never for deployed stacks."; exit 1; }
	$(COMPOSE) down -v

# ---- Backups (deployed stacks only; the daily run is a systemd timer, not make) ----

backup-now: ## Take a backup right now to R2/MinIO (ENV=dev|test|prod)
	@[ "$(ENV)" != local ] || { echo "backups need a deployed stack, e.g. make backup-now ENV=prod (there is no object storage in the local dev stack)."; exit 1; }
	$(COMPOSE) --profile backup run --rm backup daily

backup-list: ## List the dumps currently in the bucket for this env (ENV=dev|test|prod)
	@[ "$(ENV)" != local ] || { echo "backups need a deployed stack, e.g. make backup-list ENV=prod."; exit 1; }
	$(COMPOSE) --profile backup run --rm --entrypoint sh backup -c \
		'. /usr/local/bin/rclone-env.sh && rclone ls "r2:$$S3_BUCKET/backups/$(ENV)"'

backup-status: ## Show the daily-backup timer schedule + last run (ENV=dev|test|prod; on the VPS)
	@[ "$(ENV)" != local ] || { echo "the backup timer only exists on deployed stacks, e.g. make backup-status ENV=prod (run on the VPS)."; exit 1; }
	systemctl list-timers --all --no-pager 'rahaaon-backup@$(ENV).timer'
	@echo
	systemctl status --no-pager -n 20 rahaaon-backup@$(ENV).service || true

backup-install: ## First-time: install + enable the daily-backup timer for this env (ENV=dev|test|prod; sudo; on the VPS)
	@[ "$(ENV)" != local ] || { echo "the backup timer only applies to deployed stacks, e.g. make backup-install ENV=prod (run on the VPS)."; exit 1; }
	sudo cp deploy/rahaaon-backup@.service deploy/rahaaon-backup@.timer /etc/systemd/system/
	sudo systemctl daemon-reload
	sudo systemctl enable --now rahaaon-backup@$(ENV).timer
	@echo "Enabled rahaaon-backup@$(ENV).timer — verify with: make backup-status ENV=$(ENV)"

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
  COMPOSE := docker compose -p rahaaon-$(ENV) --env-file .env.$(ENV) -f docker-compose.prod.yml
  APP_SVC := api
  # DB one-offs run the built script in a throwaway container (no source in the image).
  db_run = $(COMPOSE) run --rm $(APP_SVC) node dist/db/$(1).js $(ARGS)
endif

.DEFAULT_GOAL := help

.PHONY: help env env-deploy up down restart build logs ps shell migrate seed set-admin-password psql clean

help: ## List targets. Append ENV=dev|test|prod to target a deployed stack (default: local)
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example with a generated secret (local; no-op if .env exists)
	@if [ -f .env ]; then \
		echo ".env already exists — leaving it untouched"; \
	else \
		cp .env.example .env; \
		sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" .env; \
		echo "Created .env from .env.example with a generated AUTH_SECRET — review URLs/ports if needed."; \
	fi

env-deploy: ## Create .env.$(ENV) for a deployed stack (ENV=dev|test|prod; run on the VPS)
	@[ "$(ENV)" != local ] || { echo "env-deploy needs a deployed env, e.g. make env-deploy ENV=test"; exit 1; }
	@./deploy/init-env.sh $(ENV)

up: ## Start the dev stack (app + db), detached [local only]
	@[ "$(ENV)" = local ] || { echo "up is local-only — deployed stacks are brought up by the deploy pipeline (deploy/deploy.sh / CI), not make."; exit 1; }
	$(COMPOSE) up -d

down: ## Stop the dev stack (volumes are kept) [local only]
	@[ "$(ENV)" = local ] || { echo "down is local-only — stopping a deployed stack is an outage; use the deploy pipeline."; exit 1; }
	$(COMPOSE) down

restart: ## Restart the app/api service (db untouched)
	$(COMPOSE) restart $(APP_SVC)

build: ## Rebuild the dev image (only needed when dev.Dockerfile changes) [local only]
	@[ "$(ENV)" = local ] || { echo "build is local-only — deployed stacks run pulled images built by CI."; exit 1; }
	$(COMPOSE) build

logs: ## Follow app/api logs
	$(COMPOSE) logs -f $(APP_SVC)

ps: ## Show stack status
	$(COMPOSE) ps

shell: ## Open a shell in the app/api container
	$(COMPOSE) exec $(APP_SVC) bash

migrate: ## Run database migrations
	$(call db_run,migrate)

seed: ## Seed the database — WIPES content, so refused on prod
	@[ "$(ENV)" != prod ] || { echo "refusing to seed prod — the seed WIPES all content tables (allowed: local/dev/test)."; exit 1; }
	$(call db_run,seed)

set-admin-password: ## Rotate the admin password from SEED_ADMIN_PASSWORD (non-destructive; ARGS=--revoke-sessions to sign out too)
	$(call db_run,set-admin-password)

psql: ## Open psql against the stack's database
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

clean: ## Stop the stack and DELETE all volumes (db data, node_modules) [local only]
	@[ "$(ENV)" = local ] || { echo "clean is local-only — it runs 'down -v' and DELETES volumes (DB data). Never for deployed stacks."; exit 1; }
	$(COMPOSE) down -v

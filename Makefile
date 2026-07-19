# Dev environment management. The dev stack runs the app (Vite + tsx watch)
# in a container with the repo bind-mounted — see docker-compose.dev.yml.
#
# Host ports are overridable to avoid clashes: WEB_PORT=5175 API_PORT=3002 make up

COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.DEFAULT_GOAL := help

.PHONY: help env up down restart build logs ps shell migrate seed psql clean

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example with a generated secret (no-op if .env exists)
	@if [ -f .env ]; then \
		echo ".env already exists — leaving it untouched"; \
	else \
		cp .env.example .env; \
		sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" .env; \
		echo "Created .env from .env.example with a generated AUTH_SECRET — review URLs/ports if needed."; \
	fi

up: ## Start the dev stack (app + db), detached
	$(COMPOSE) up -d

down: ## Stop the dev stack (volumes are kept)
	$(COMPOSE) down

restart: ## Restart the app container (db untouched)
	$(COMPOSE) restart app

build: ## Rebuild the dev image (only needed when dev.Dockerfile changes)
	$(COMPOSE) build

logs: ## Follow app logs
	$(COMPOSE) logs -f app

ps: ## Show stack status
	$(COMPOSE) ps

shell: ## Open a shell in the app container
	$(COMPOSE) exec app bash

migrate: ## Run database migrations (inside the app container)
	$(COMPOSE) exec app pnpm db:migrate

seed: ## Seed the database (inside the app container)
	$(COMPOSE) exec app pnpm db:seed

psql: ## Open psql against the dev database
	$(COMPOSE) exec db psql -U rahaaon -d rahaaon

clean: ## Stop the stack and DELETE all volumes (db data, node_modules)
	$(COMPOSE) down -v

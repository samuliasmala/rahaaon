# Dev environment management. Only Postgres runs in Docker (docker-compose.yml);
# the app itself (web + api) runs on the host via `pnpm dev`.

COMPOSE := docker compose

.DEFAULT_GOAL := help

.PHONY: help env up down dev logs ps migrate seed psql clean

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

up: ## Start Postgres, detached
	$(COMPOSE) up -d

down: ## Stop Postgres (volume is kept)
	$(COMPOSE) down

dev: ## Run the app on the host (web + api via turbo)
	pnpm dev

logs: ## Follow Postgres logs
	$(COMPOSE) logs -f db

ps: ## Show stack status
	$(COMPOSE) ps

migrate: ## Run database migrations (on the host)
	pnpm db:migrate

seed: ## Seed the database (on the host)
	pnpm db:seed

psql: ## Open psql against the dev database
	$(COMPOSE) exec db psql -U rahaaon -d rahaaon

clean: ## Stop Postgres and DELETE the db volume
	$(COMPOSE) down -v

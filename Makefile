# sakuda — task runner. Every port/secret comes from .env (copy .env.example).
#
# Precedence: CLI (`make up SAKUDA_PORT=3005`) > .env > defaults below.

-include .env
export

SAKUDA_PORT    ?= 3001
SAKUDA_BIND    ?= 127.0.0.1
JUICESHOP_PORT ?= 4001
COMPOSE        ?= docker compose
# Juice Shop is its own compose project (targets/juice-shop/compose.yml), so
# sakuda's down/reset never touch it. Compose looks for .env next to the
# compose file, so point it at the root .env explicitly (when one exists —
# the defaults above cover a checkout without it).
JUICE_COMPOSE  ?= $(COMPOSE) $(if $(wildcard .env),--env-file .env) -f targets/juice-shop/compose.yml

.DEFAULT_GOAL := help
.PHONY: help env keygen build up down restart logs ps open juice-up juice-down \
        dev test e2e lint typecheck check clean reset-data

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  ports: sakuda http://localhost:$(SAKUDA_PORT)  juice-shop http://localhost:$(JUICESHOP_PORT)  (bind $(SAKUDA_BIND))"

## ---- setup ---------------------------------------------------------------

env: ## Create .env from .env.example (keeps an existing .env) and fill the encryption key
	@if [ -f .env ]; then echo ".env exists — leaving it alone"; else \
	  cp .env.example .env; \
	  key="$$(pnpm -s keygen)"; \
	  sed -i '' "s|^SAKUDA_ENCRYPTION_KEY=.*|SAKUDA_ENCRYPTION_KEY=$$key|" .env; \
	  echo "wrote .env with a fresh SAKUDA_ENCRYPTION_KEY — keep it safe"; fi

keygen: ## Print a new SAKUDA_ENCRYPTION_KEY
	@pnpm -s keygen

## ---- docker (production-like, one container) -----------------------------

build: ## Build the sakuda image (ZAP + nuclei + templates + app)
	$(COMPOSE) build sakuda

up: ## Start sakuda in the background (http://localhost:SAKUDA_PORT)
	$(COMPOSE) up -d sakuda
	@echo "sakuda: http://localhost:$(SAKUDA_PORT)"

down: ## Stop and remove the sakuda container (data volume kept; Juice Shop untouched)
	$(COMPOSE) down

restart: ## Restart sakuda
	$(COMPOSE) restart sakuda

logs: ## Follow sakuda logs
	$(COMPOSE) logs -f sakuda

ps: ## Show container status (sakuda, then Juice Shop)
	$(COMPOSE) ps
	@$(JUICE_COMPOSE) ps

open: ## Open the UI in the browser
	open "http://localhost:$(SAKUDA_PORT)"

juice-up: ## Start OWASP Juice Shop as a dry-run target (http://localhost:JUICESHOP_PORT)
	$(JUICE_COMPOSE) up -d
	@echo "juice-shop: http://localhost:$(JUICESHOP_PORT)  → register a site with frontBaseUrl=http://localhost:$(JUICESHOP_PORT)"

juice-down: ## Stop and remove Juice Shop (its accounts reset on the next start)
	$(JUICE_COMPOSE) down

## ---- local development (native nuclei, ZAP via scripts/zap-docker.sh) ----

dev: ## Run the Nuxt dev server on SAKUDA_PORT
	pnpm dev --port $(SAKUDA_PORT)

test: ## Unit + component tests
	pnpm test

e2e: ## API e2e tests
	pnpm test:e2e

lint: ## ESLint + Prettier check
	pnpm lint

typecheck: ## nuxt typecheck
	pnpm run typecheck

check: lint typecheck test ## Everything CI runs

## ---- cleanup -------------------------------------------------------------

clean: ## Remove local build output and dev scan data (./data, .output, .nuxt)
	rm -rf data .output .nuxt

reset-data: ## DESTRUCTIVE: delete the docker data volume (sites, scans, encrypted headers). Requires CONFIRM=1
	@if [ "$(CONFIRM)" != "1" ]; then echo "refusing: run 'make reset-data CONFIRM=1' to delete the sakuda-data volume"; exit 1; fi
	$(COMPOSE) down -v

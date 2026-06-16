# Markup — visual screen review
# Common tasks. Run `make` (or `make help`) to list available targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Web app port — keep in sync with the `-p` flag in package.json's dev/start scripts.
PORT := 3900

.PHONY: help init install browsers kill-port dev build start lint typecheck check mcp clean reset-data

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

init: install browsers ## First-time setup: install deps + Playwright Chromium
	@echo ""
	@echo "✓ Ready. Next steps:"
	@echo "    make dev   # start the web app at http://localhost:$(PORT)"
	@echo "    make mcp   # run the MCP server (Claude Code / Cursor)"

install: ## Install npm dependencies
	npm install

browsers: ## Install the Playwright Chromium browser (needed for capture)
	npx playwright install chromium

kill-port: ## Free the app port (3900): kill any process LISTENing on it
	@pids=$$(lsof -nP -iTCP:$(PORT) -sTCP:LISTEN -t 2>/dev/null); \
	if [ -n "$$pids" ]; then echo "Port $(PORT) in use (PID $$pids) — killing"; kill -9 $$pids 2>/dev/null || true; \
	else echo "Port $(PORT) is free"; fi

dev: kill-port ## Start the Next.js dev server (http://localhost:3900)
	npm run dev

build: ## Production build
	npm run build

start: build kill-port ## Build, then run the production server (frees the port first)
	npm run start

lint: ## Run ESLint
	npm run lint

typecheck: ## Type-check with tsc (no emit)
	npx tsc --noEmit

check: lint typecheck ## Lint + type-check

mcp: ## Run the MCP server (stdio) for Claude Code / Cursor
	npm run mcp

clean: ## Remove build artifacts (.next) — keeps your ./data
	rm -rf .next

reset-data: ## DANGER: delete ALL local data (projects, screenshots, exports)
	@read -r -p "This deletes ./data (all projects/screenshots/exports). Type 'yes' to confirm: " ans; \
	if [ "$$ans" = "yes" ]; then rm -rf data && echo "✓ data/ removed"; else echo "Aborted."; fi

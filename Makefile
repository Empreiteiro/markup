# Markup — visual screen review
# Common tasks. Run `make` (or `make help`) to list available targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help init install browsers dev build start lint typecheck check mcp clean reset-data

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

init: install browsers ## First-time setup: install deps + Playwright Chromium
	@echo ""
	@echo "✓ Ready. Next steps:"
	@echo "    make dev   # start the web app at http://localhost:3000"
	@echo "    make mcp   # run the MCP server (Claude Code / Cursor)"

install: ## Install npm dependencies
	npm install

browsers: ## Install the Playwright Chromium browser (needed for capture)
	npx playwright install chromium

dev: ## Start the Next.js dev server (http://localhost:3000)
	npm run dev

build: ## Production build
	npm run build

start: build ## Build, then run the production server
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

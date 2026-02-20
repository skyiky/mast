# Mast — Common Commands
# Usage: make <target>

# ─── Dev ──────────────────────────────────────────────────────────────────────

.PHONY: install dev-orchestrator dev-daemon dev-mobile test test-orchestrator test-daemon

install: ## Install all workspace dependencies
	npm install

dev-orchestrator: ## Run orchestrator locally (in-memory store)
	npm run dev --workspace=packages/orchestrator

dev-daemon: ## Run daemon locally (connects to local orchestrator)
	npm run dev --workspace=packages/daemon

dev-mobile: ## Start Expo dev server for mobile app
	cd packages/mobile && npx expo start

test: ## Run all tests (110 total)
	npm test

test-orchestrator: ## Run orchestrator tests only (95 tests)
	npm test --workspace=packages/orchestrator

test-daemon: ## Run daemon tests only (15 tests)
	npm test --workspace=packages/daemon

# ─── Azure ────────────────────────────────────────────────────────────────────

REGISTRY    := your-registry
RG          := your-resource-group
APP         := mast-orchestrator
IMAGE       := your-registry.azurecr.io/mast-orchestrator
VERSION     ?= latest

.PHONY: deploy deploy-build deploy-update logs health

deploy: deploy-build deploy-update ## Build image and deploy to Azure (use VERSION=v2 etc.)

deploy-build: ## Build and push Docker image to ACR
	az acr build --registry $(REGISTRY) --resource-group $(RG) \
		--image mast-orchestrator:$(VERSION) --platform linux/amd64 .

deploy-update: ## Update container app to use new image
	az containerapp update --name $(APP) --resource-group $(RG) \
		--image $(IMAGE):$(VERSION)

logs: ## Tail container app logs
	az containerapp logs show --name $(APP) --resource-group $(RG) --tail 50 --follow

health: ## Check orchestrator health endpoint
	@curl -s https://your-orchestrator.azurecontainerapps.io/health | python -m json.tool

# ─── Supabase ─────────────────────────────────────────────────────────────────

.PHONY: db-push db-status

db-push: ## Push pending migrations to Supabase
	npx supabase db push

db-status: ## Show migration status
	npx supabase migration list

# ─── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

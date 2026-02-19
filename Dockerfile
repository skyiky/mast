# Railway deployment for Mast orchestrator
# Uses tsx for TypeScript execution (same as dev)

FROM node:24-slim

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json ./

# Copy all packages (workspace resolution needs them)
COPY packages/shared/ packages/shared/
COPY packages/orchestrator/ packages/orchestrator/

# Install dependencies
RUN npm ci --workspace=packages/orchestrator --workspace=packages/shared

# Expose port (Railway sets PORT env var)
EXPOSE 3000

# Health check — uses the existing /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the orchestrator
CMD ["npx", "tsx", "packages/orchestrator/src/index.ts"]

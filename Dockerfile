# Azure Container Apps deployment for Mast orchestrator
# Serves the web client (pre-built) and orchestrator API

FROM node:24-slim

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json ./

# Copy packages needed at runtime (workspace resolution needs them)
COPY packages/shared/ packages/shared/
COPY packages/orchestrator/ packages/orchestrator/

# Copy pre-built web client dist (must run `npm run build` in packages/web first)
COPY packages/web/dist/ packages/web/dist/

# Install dependencies
RUN npm ci --workspace=packages/orchestrator --workspace=packages/shared

# Tell the orchestrator where the web client dist lives
ENV WEB_DIST_PATH=/app/packages/web/dist

# Expose port (Azure Container Apps sets PORT env var)
EXPOSE 3000

# Health check using Node.js (curl not available in node:24-slim)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Start the orchestrator
CMD ["npx", "tsx", "packages/orchestrator/src/index.ts"]

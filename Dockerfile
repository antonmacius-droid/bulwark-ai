# ============================================================
# Bulwark AI — Multi-stage Docker build
# Produces a minimal Alpine image serving the gateway API
# (port 3100) and admin dashboard (port 3101).
# ============================================================

# ------ Stage 1: Build TypeScript gateway package -----------
FROM node:22-alpine AS build-gateway

WORKDIR /build

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY packages/typescript/package.json packages/typescript/package-lock.json ./
RUN npm ci

COPY packages/typescript/ ./
RUN npm run build

# ------ Stage 2: Build Admin UI -----------------------------
FROM node:22-alpine AS build-ui

WORKDIR /build

COPY packages/admin-ui/package.json packages/admin-ui/package-lock.json ./
RUN npm ci

COPY packages/admin-ui/ ./
RUN npm run build

# ------ Stage 3: Production runtime -------------------------
FROM node:22-alpine AS runtime

RUN apk add --no-cache tini

WORKDIR /app

# Re-install production dependencies with native module support
RUN apk add --no-cache python3 make g++

COPY packages/typescript/package.json packages/typescript/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

# Copy compiled gateway
COPY --from=build-gateway /build/dist ./dist
COPY --from=build-gateway /build/src ./src

# Copy compiled admin UI
COPY --from=build-ui /build/dist ./admin-ui

# Copy entrypoint
COPY docker-entrypoint.ts ./

# Install tsx for running the TypeScript entrypoint
RUN npm install -g tsx

# Data directory for SQLite persistence
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

# Gateway API + Admin UI
EXPOSE 3100 3101

USER node

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["tsx", "docker-entrypoint.ts"]

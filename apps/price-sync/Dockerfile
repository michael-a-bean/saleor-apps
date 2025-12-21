# Price Sync Worker Dockerfile
# Uses monorepo context (build from saleor-apps directory)

FROM node:22-alpine AS base

# Install dependencies stage
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy package files
COPY apps/price-sync/package.json ./apps/price-sync/
# Copy inventory-ops prisma schema (shared database)
COPY apps/inventory-ops/prisma/ ./apps/inventory-ops/prisma/

WORKDIR /app/apps/price-sync

# Install dependencies
RUN pnpm install

# Build stage
FROM base AS builder
WORKDIR /app

RUN apk add --no-cache openssl

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY --from=deps /app ./

WORKDIR /app/apps/price-sync

# Copy source files
COPY apps/price-sync/src ./src
COPY apps/price-sync/tsconfig.json ./
COPY apps/price-sync/tsup.config.ts ./

# Generate Prisma client (uses symlink to ../inventory-ops/prisma)
RUN pnpm db:generate

# Build TypeScript
RUN pnpm build

# Production stage
FROM base AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy built files
COPY --from=builder /app/apps/price-sync/dist ./dist
COPY --from=builder /app/apps/price-sync/node_modules ./node_modules
COPY --from=builder /app/apps/price-sync/package.json ./

# Set ownership
RUN chown -R worker:nodejs /app

USER worker

# Default command (can be overridden)
CMD ["node", "dist/index.mjs", "help"]

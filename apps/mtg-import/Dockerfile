FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy all package.json files to preserve workspace structure
COPY packages/ ./packages/
COPY apps/mtg-import/ ./apps/mtg-import/

# Install dependencies
# IMPORTANT: Use --frozen-lockfile for reproducible builds
# If this fails, update pnpm-lock.yaml locally first: pnpm install
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

RUN apk add --no-cache openssl

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Skip env validation during build - real values come from runtime env
# BASE_PATH enables path-based ALB routing in staging
ARG BASE_PATH=""
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_PUBLIC_BASE_PATH=${BASE_PATH}

COPY --from=deps /app ./

# Generate Prisma client
RUN cd apps/mtg-import && pnpm prisma generate

# Write BASE_PATH to .env file for Next.js to read during build
# This ensures basePath is baked into the static assets
RUN echo "BASE_PATH=${BASE_PATH}" > /app/apps/mtg-import/.env && \
    echo "NEXT_PUBLIC_BASE_PATH=${BASE_PATH}" >> /app/apps/mtg-import/.env

# Build the app and its dependencies
ENV SKIP_ENV_VALIDATION=true
RUN pnpm turbo run build --filter=saleor-app-mtg-import

# Production stage
FROM base AS runner
WORKDIR /app

# Install curl for health checks, openssl for Prisma
RUN apk add --no-cache curl openssl

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application with correct ownership
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/mtg-import ./apps/mtg-import

WORKDIR /app/apps/mtg-import

# Create data directory for APL storage with correct ownership
RUN mkdir -p data && chown nextjs:nodejs data

# Create cache directory for Scryfall data
RUN mkdir -p /tmp/scryfall-cache && chown nextjs:nodejs /tmp/scryfall-cache

USER nextjs

EXPOSE 3005
ENV HOSTNAME=0.0.0.0
ENV PORT=3005

CMD ["pnpm", "start"]

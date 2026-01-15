FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy all package.json files to preserve workspace structure
COPY packages/ ./packages/
COPY apps/stripe/ ./apps/stripe/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Build-time env vars required by Next.js
ARG SECRET_KEY=build-placeholder
ARG DYNAMODB_MAIN_TABLE_NAME=stripe-main-table
ARG AWS_REGION=localhost
ARG AWS_ACCESS_KEY_ID=local
ARG AWS_SECRET_ACCESS_KEY=local
ARG BASE_PATH=""

ENV SECRET_KEY=${SECRET_KEY}
ENV DYNAMODB_MAIN_TABLE_NAME=${DYNAMODB_MAIN_TABLE_NAME}
ENV AWS_REGION=${AWS_REGION}
ENV AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
ENV AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_PUBLIC_BASE_PATH=${BASE_PATH}

COPY --from=deps /app ./

# Create .env file for the stripe app build
RUN echo 'SECRET_KEY=build-placeholder' > /app/apps/stripe/.env && \
    echo 'DYNAMODB_MAIN_TABLE_NAME=stripe-main-table' >> /app/apps/stripe/.env && \
    echo 'AWS_REGION=localhost' >> /app/apps/stripe/.env && \
    echo 'AWS_ACCESS_KEY_ID=local' >> /app/apps/stripe/.env && \
    echo 'AWS_SECRET_ACCESS_KEY=local' >> /app/apps/stripe/.env && \
    echo "BASE_PATH=${BASE_PATH}" >> /app/apps/stripe/.env && \
    echo "NEXT_PUBLIC_BASE_PATH=${BASE_PATH}" >> /app/apps/stripe/.env

# Patch _app.tsx with crypto.randomUUID polyfill for HTTP staging environments
# The Saleor App SDK uses crypto.randomUUID() which only works in secure contexts
# This polyfill uses crypto.getRandomValues() which works in non-secure contexts
# We prepend polyfill code via heredoc to maintain proper formatting with eslint-disable
RUN cat > /tmp/polyfill.ts << 'POLYFILL'
/* eslint-disable */
/* Polyfill for crypto.randomUUID() in non-secure contexts (HTTP) */
if (typeof window !== "undefined" && typeof crypto !== "undefined" && !crypto.randomUUID) {
  crypto.randomUUID = function randomUUID() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return (hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20)) as `${string}-${string}-${string}-${string}-${string}`;
  };
}
/* eslint-enable */

POLYFILL
RUN cat /tmp/polyfill.ts /app/apps/stripe/src/pages/_app.tsx > /tmp/_app.tsx && \
    mv /tmp/_app.tsx /app/apps/stripe/src/pages/_app.tsx

# Build the stripe app and its dependencies
RUN pnpm turbo run build --filter=saleor-app-payment-stripe

# Production stage
FROM base AS runner
WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/stripe ./apps/stripe

WORKDIR /app/apps/stripe

# Remove build-time .env file that contains placeholder AWS credentials
# This allows the AWS SDK to use ECS task role credentials at runtime
RUN rm -f .env

USER nextjs

EXPOSE 3001
ENV PORT=3001

CMD ["sh", "-c", "./node_modules/.bin/next start --port 3001"]

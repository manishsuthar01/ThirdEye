FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack (built into Node.js)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo manifests first (optimizes Docker layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types ./packages/types
COPY apps/source-fetcher ./apps/source-fetcher

# Install dependencies and compile TypeScript
RUN pnpm --filter @thirdeye/source-fetcher install --frozen-lockfile
RUN pnpm --filter @thirdeye/source-fetcher build

FROM node:20-alpine AS runner

WORKDIR /app

# 1. Install GNU tar and gzip (essential for --strip-components)
RUN apk add --no-cache tar gzip

ENV NODE_ENV=production

# 2. Copy compiled JavaScript from the builder stage
COPY --from=builder /app/apps/source-fetcher/dist ./dist
COPY --from=builder /app/apps/source-fetcher/package.json ./package.json

# 3. Security Hardening: Run as unprivileged non-root user
USER node

# 4. Entrypoint
ENTRYPOINT ["node", "dist/index.js"]
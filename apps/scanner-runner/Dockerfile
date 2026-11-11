# Compartment 2: Scanner Runner Container
# Responsibility: Execute OpenGrep (SAST) and Trivy (SCA/Secrets) in strict offline isolation (--network none).

# Stage 1: Build the TypeScript Runner Application
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo manifests first for optimal Docker layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types ./packages/types
COPY apps/scanner-runner ./apps/scanner-runner

# Install dependencies and build TypeScript into dist/
RUN pnpm --filter @thirdeye/scanner-runner install --frozen-lockfile
RUN pnpm --filter @thirdeye/scanner-runner build

# Stage 2: Hardened Runtime Container
FROM node:20-alpine AS runner

# Install Trivy and OpenGrep prerequisites
RUN apk add --no-cache curl bash python3 py3-pip git ca-certificates \
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
    && pip install --no-cache-dir --break-system-packages opengrep

WORKDIR /app

ENV NODE_ENV=production

# Copy preloaded rulesets into /rules
COPY apps/scanner-runner/rules /rules

# Copy compiled JavaScript from builder
COPY --from=builder /app/apps/scanner-runner/dist ./dist
COPY --from=builder /app/apps/scanner-runner/package.json ./package.json

# Create dedicated unprivileged non-root user (UID 10001)
RUN addgroup -g 10001 thirdeye \
    && adduser -D -u 10001 -G thirdeye thirdeye \
    && chown -R 10001:10001 /app /rules

# Run as non-root
USER 10001:10001

ENTRYPOINT ["node", "dist/index.js"]

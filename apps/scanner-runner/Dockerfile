# Stage 1: Build TypeScript inside the monorepo context
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo manifests and root configurations
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/types ./packages/types
COPY apps/scanner-runner ./apps/scanner-runner

# Install dependencies and build TypeScript into dist/
RUN pnpm --filter @thirdeye/scanner-runner install --frozen-lockfile
RUN pnpm --filter @thirdeye/scanner-runner build

# Stage 2: Hardened Runtime Container
FROM node:20-alpine AS runner

# Install dependencies, Trivy, and OpenGrep standalone musl binary
RUN apk add --no-cache curl bash git ca-certificates \
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
    && curl -fsSL -o /usr/local/bin/opengrep https://github.com/opengrep/opengrep/releases/latest/download/opengrep_musllinux_x86 \
    && chmod +x /usr/local/bin/opengrep

# Create dedicated unprivileged non-root user (UID 10001) with home directory
RUN addgroup -g 10001 thirdeye \
    && adduser -D -u 10001 -G thirdeye -h /home/thirdeye thirdeye

# Pre-initialize scanner caches during build (while network is available)
# so the container works fully offline at runtime (--network none)
USER thirdeye
ENV HOME=/home/thirdeye
RUN trivy image --download-db-only \
    && opengrep --version

# Switch back to root to copy application files
USER root
WORKDIR /app
ENV NODE_ENV=production

# Copy preloaded rulesets into /rules
COPY apps/scanner-runner/rules /rules

# Copy compiled JavaScript from builder
COPY --from=builder /app/apps/scanner-runner/dist ./dist
COPY --from=builder /app/apps/scanner-runner/package.json ./package.json

RUN chown -R 10001:10001 /app /rules /home/thirdeye

# Drop privileges permanently to non-root user
USER 10001:10001

ENTRYPOINT ["node", "dist/index.js"]

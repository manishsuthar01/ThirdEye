# Compartment 1: Source Fetcher Container
# Responsibility: Download Base and Head snapshots with restricted HTTPS egress.
FROM node:20-alpine AS builder

WORKDIR /app

# TODO: Copy package definitions and install dependencies
# COPY package.json ./

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Runs as non-root user
USER node

# Entrypoint to run the source fetcher script
ENTRYPOINT ["node", "dist/index.js"]


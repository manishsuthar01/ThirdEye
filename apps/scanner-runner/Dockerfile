# Compartment 2: Scanner Runner Container
# Responsibility: Execute OpenGrep and Trivy with --network none, read-only rootfs, and unprivileged user.
FROM node:20-alpine AS base

# TODO: Install OpenGrep binary and Trivy binary
# RUN apk add --no-cache ...

# Preload Trivy database and OpenGrep rulesets into the image for offline scanning
# COPY ./rules /rules
# COPY ./trivy-db /var/trivy/db

WORKDIR /app

# Non-root user (UID 10001)
USER 10001:10001

ENTRYPOINT ["node", "dist/index.js"]


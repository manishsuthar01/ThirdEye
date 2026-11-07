# ThirdEye

Developer-First AppSec, Deployment Observability, and Incident Correlation Platform.

---

## Overview

ThirdEye bridges the operational gap between **pull request security**, **code deployments**, and **production health**. Modern production incidents and security regressions are overwhelmingly introduced by new code pushes, database migrations, or configuration releases.

ThirdEye continuously monitors pull requests and deployments from GitHub and Vercel. It executes static security analysis inside **zero-trust compartmentalized sandboxes**, computes the **Security Delta** (Base vs. Head revision), and correlates production anomalies to the exact commit, author, and pull request that triggered them.

---

## System Architecture

```text
GitHub App / Vercel Webhooks
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ apps/api: Fast Ingestion Gateway (Express / Node.js)    │
│ • HMAC SHA-256 Signature Verification                   │
│ • Adapter Normalization (PRs: opened, sync, reopen)     │
│ • Fast Non-Blocking Acknowledgment (HTTP 202 Accepted)  │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│ packages/queue: AMQP Message Broker (RabbitMQ)          │
│ • Exchange: thirdeye.events (Topic)                     │
│ • Routing Keys: deployment.github.#, error.#, incident.#│
│ • Dead-Letter Handling: thirdeye.dlx -> DLQ             │
└──────────────┬───────────────────────────┬──────────────┘
               │                           │
               ▼                           ▼
┌───────────────────────────────┐  ┌───────────────────────┐
│ apps/worker: Orchestrator     │  │ Error / Correlation   │
│ • Manages Sandbox Lifecycle   │  │ Workers               │
│ • Enforces Timeouts & Cleanup │  │ • Error Grouping      │
│ • Never runs untrusted code   │  │ • Time-Window Match   │
└──────────────┬────────────────┘  └───────────┬───────────┘
               │                               │
               ▼                               │
┌───────────────────────────────┐              │
│ Compartment 1: Source Fetcher │              │
│ • Read-Only Scoped Token      │              │
│ • Downloads Base & Head trees │              │
└──────────────┬────────────────┘              │
               │ (Writes to ephemeral mount)   │
               ▼                               │
┌───────────────────────────────┐              │
│ Compartment 2: Scanner Runner │              │
│ • STRICT ISOLATION (--net none│              │
│ • Read-only rootfs, unpriv UID│              │
│ • Offline OpenGrep & Trivy    │              │
│ • Emits canonical JSON report │              │
└──────────────┬────────────────┘              │
               │                               │
               └───────────────┬───────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│ packages/analysis: Security Intelligence & Comparison   │
│ • Resilient Fingerprinting (tolerant to line drift)     │
│ • Security Delta Engine: Base vs. Head Diff             │
│   -> Categorizes: New (Regressions), Resolved, Debt     │
│ • Future: Custom Cross-Layer AST Authorization Engine   │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│ packages/database: Persistence Layer (PostgreSQL)       │
│ • Scan Result Snapshot Cache (repoId, commitSHA, hash)  │
│ • Relational Source of Truth (Deployments, Incidents)   │
└──────────────────────────────┬──────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
┌───────────────────────────────┐ ┌───────────────────────┐
│ GitHub Checks API Dispatcher  │ │ apps/web: Dashboard   │
│ • PR Annotations & Summaries  │ │ • Unified Timeline    │
│ • Block / Warn on Regressions │ │ • Incident Tracking   │
└───────────────────────────────┘ └───────────────────────┘
```

---

## Core Capabilities

### 1. High-Throughput Webhook Ingestion
- **Zero-SDK Ingestion**: Consumes native webhook events directly from GitHub (pull requests, pushes) and Vercel (deployments).
- **Cryptographic Verification**: Validates incoming payloads using HMAC SHA-256 signatures before deserialization.
- **Sub-10ms Gatekeeper**: Deserializes and publishes normalized events to the broker, returning `202 Accepted` immediately to prevent upstream webhook timeouts.

### 2. Message Broker Architecture (`packages/queue`)
- **Protocol**: AMQP 0-9-1 using `amqplib`.
- **Topic Exchange Topology**: Hierarchical routing keys (e.g., `deployment.github.pull_request`, `error.runtime`).
- **Flow Control & Backpressure**: Consumers configure explicit QoS prefetch limits (`channel.prefetch(5)`) to prevent worker memory exhaustion during PR bursts.
- **Fault Tolerance**: Unrecoverable/poison-pill messages are rejected without requeue (`requeue: false`) and routed through `thirdeye.dlx` to `thirdeye.failed_events_dlq`.

### 3. Compartmentalized Zero-Trust Sandboxing
- **Separation of Source Acquisition and Analysis**:
  - **`source-fetcher`**: Operates with restricted HTTPS network egress and a short-lived read-only GitHub token to download Base and Head snapshots. Never executes repository code.
  - **`scanner-runner`**: Runs with `--network none`, stripped Linux capabilities (`--cap-drop ALL`), non-root user (`10001:10001`), read-only root filesystem, and no credentials whatsoever.
- **Deterministic Offline Scanning**: Trivy vulnerability database and OpenGrep rulesets are pre-baked into container images, enabling instant, reproducible offline scanning without internet access.

### 4. Intelligence & Security Delta Engine (`packages/analysis`)
- **Resilient Fingerprinting**: Hashes `ruleId + normalizedRelativePath + codeSink` so line shifts do not produce false-positive alerts.
- **Two-Snapshot Security Delta**: Classifies findings into:
  - **New**: Introduced in this PR (regressions that block/warn).
  - **Resolved**: Pre-existing issues fixed by this PR.
  - **Persistent**: Pre-existing technical debt.
- **Snapshot Caching**: Caches scan outputs by `(repoId, commitSHA, configHash)` to reuse Base scans across multiple PRs.

### 5. Root-Cause Incident Correlation (Long-Term)
- **Time-Window Correlation**: Evaluates error rate surges starting within $X$ minutes of a deployment completion.
- **Unified Timeline**: Connects production incidents directly to the responsible commit SHA, author, and pull request.

---

## Monorepo Workspace Topology

The repository is organized as a `pnpm` monorepo separating infrastructure, orchestration, and pure domain logic:

```text
ThirdEye/
├── apps/
│   ├── api/            # Webhook ingestion server (Express, TypeScript)
│   ├── worker/         # Event consumer and sandbox orchestrator
│   ├── web/            # Observability dashboard (Next.js App Router, TailwindCSS)
│   ├── source-fetcher/ # Ephemeral container for fetching repository snapshots
│   └── scanner-runner/ # Ephemeral zero-network container running OpenGrep & Trivy
│
├── packages/
│   ├── analysis/       # Security delta engine, fingerprinting, and rule normalization
│   ├── queue/          # RabbitMQ connection manager, topology, and contracts
│   ├── database/       # PostgreSQL schema, migrations, and query clients
│   └── types/          # Shared domain models and canonical event interfaces
│
├── docs/               # Technical specifications and architectural deep dives
├── docker-compose.yml  # Local infrastructure (PostgreSQL, RabbitMQ)
└── pnpm-workspace.yaml
```

---

## Tech Stack

| Domain | Technology | Rationale |
| :--- | :--- | :--- |
| **Monorepo** | pnpm Workspaces, TypeScript 5 | Strict workspace boundaries, shared types, fast builds |
| **API Ingestion** | Node.js, Express | Lightweight, low-latency HTTP request processing |
| **Worker Engine** | Node.js (Standalone Process) | Decoupled background processing with prefetch control |
| **Static Analysis (SAST)**| OpenGrep | Structural code pattern matching and intrafile taint analysis |
| **Dependency & Secrets** | Trivy | Industry-standard lockfile and credential scanning |
| **Sandboxing** | Docker (Ephemeral `--rm`) | Zero-trust container execution with `--network none` |
| **Message Broker** | RabbitMQ (AMQP 0-9-1) | Durable queues, topic routing, native DLX support |
| **Primary Database** | PostgreSQL 16 | ACID transactions, strict relational consistency |
| **Frontend** | Next.js (App Router), React, Tailwind | Server components, real-time timeline visualization |

---

## Getting Started

### Prerequisites
- **Node.js**: v20 or higher
- **pnpm**: v9 or higher
- **Docker**: For running local PostgreSQL and RabbitMQ instances and executing scanner sandboxes

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/manishsuthar01/ThirdEye.git
cd ThirdEye
pnpm install
```

### 2. Start Local Infrastructure

Spin up PostgreSQL and RabbitMQ using Docker Compose:

```bash
docker compose up -d
```

- **PostgreSQL**: `localhost:5432`
- **RabbitMQ AMQP**: `localhost:5672`
- **RabbitMQ Management UI**: `http://localhost:15672` (Default credentials: `thirdeye` / `thirdeye`)

### 3. Configure Environment Variables

Create `.env` in the project root:

```env
# Application
PORT=4000
WORKER_CONCURRENCY=5

# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/thirdeye

# RabbitMQ
RABBITMQ_URL=amqp://thirdeye:thirdeye@localhost:5672
RABBITMQ_EXCHANGE=thirdeye.events
RABBITMQ_DLX_EXCHANGE=thirdeye.dlx

# Webhook Secrets
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret
VERCEL_WEBHOOK_SECRET=your_vercel_webhook_secret

# GitHub App Integration
GITHUB_APP_ID=your_app_id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
```

### 4. Run Services in Development

You can run individual workspace apps concurrently:

```bash
# Ingestion API server
pnpm dev:api

# Background Worker
pnpm dev:worker

# Next.js Dashboard
pnpm dev:web
```

---

## Architectural Documentation

For comprehensive engineering specifications, refer to:
- [System Design & Architecture Specification](architecture.md)
- [Worker Architecture & Security Analysis Pipeline](docs/SECURITY_ANALYSIS_PIPELINE.md)
- [Monorepo Design & Trade-offs](MONOREPO_GUIDE.md)
- [Distributed Systems Edge Cases & Failure Modes](EDGE_CASES.md)

---

## License

This project is licensed under the MIT License.

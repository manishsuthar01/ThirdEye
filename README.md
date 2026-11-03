# ThirdEye

Deployment Observability, Security Analysis, and Incident Correlation Platform.

---

## Overview

ThirdEye bridges the operational gap between **code deployments** and **production health**. Modern production incidents and security regressions are overwhelmingly introduced by new code pushes, database migrations, or configuration releases. 

ThirdEye continuously monitors deployments from GitHub and Vercel, ingests real-time application errors, runs deterministic static security analysis on code deltas, and correlates production anomalies to the exact commit, author, and pull request that triggered them.

---

## System Architecture

```text
GitHub / Vercel Webhooks
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ apps/api: Fast Ingestion Gateway (Express / Node.js)    │
│ • HMAC SHA-256 Signature Verification                   │
│ • Adapter Normalization (NormalizedWebhookEvent)        │
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
│ apps/worker: Background Fleet │  │ Error / Correlation   │
│ • GitHub Diff Ingestion       │  │ Workers               │
│ • Delta Risk Analysis Pipeline│  │ • Error Grouping      │
│ • Prefetch & Concurrency Limit│  │ • Time-Window Match   │
└──────────────┬────────────────┘  └───────────┬───────────┘
               │                               │
               └───────────────┬───────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│ packages/analysis: Pure Deterministic Engine            │
│ • Native TypeScript Compiler API AST Traverser          │
│ • Security Rules: Route Gate, Secret Leaks, IDOR        │
│ • Unified Diff Parser & Delta Risk Scorer (0 - 100)     │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│ packages/database: Persistence Layer (PostgreSQL)       │
│ • Relational Source of Truth (Deployments, Incidents)   │
│ • ACID Idempotency Constraints                          │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│ apps/web: Next.js Observability Dashboard               │
│ • Unified Chronological Deployment & Incident Timeline  │
│ • Real-time Risk Scores and Regression Metrics          │
└─────────────────────────────────────────────────────────┘
```

---

## Core Capabilities

### 1. High-Throughput Webhook Ingestion
- **Zero-SDK Ingestion**: Consumes native webhook events directly from GitHub (pushes, pull requests) and Vercel (deployments, build status).
- **Cryptographic Verification**: Validates incoming payloads using HMAC SHA-256 signatures (`X-Hub-Signature-256` and `x-vercel-signature`) before deserialization.
- **Sub-10ms Gatekeeper**: Deserializes and publishes normalized events to the broker, returning `202 Accepted` immediately to prevent upstream webhook timeouts.

### 2. Message Broker Architecture (`packages/queue`)
- **Protocol**: AMQP 0-9-1 using `amqplib`.
- **Topic Exchange Topology**: Published events use hierarchical routing keys (e.g., `deployment.github.push`, `deployment.vercel.succeeded`, `error.runtime`).
- **Flow Control & Backpressure**: Consumers configure explicit QoS prefetch limits (`channel.prefetch(N)`) to prevent worker memory exhaustion during deployment bursts.
- **Fault Tolerance**: Unrecoverable/poison-pill messages are rejected without requeue (`requeue: false`) and routed through `thirdeye.dlx` to `thirdeye.failed_events_dlq` for forensic analysis.

### 3. Static Security Analysis Engine (`packages/analysis`)
- **Zero External Dependencies**: Built directly on the native TypeScript Compiler API (`typescript`).
- **Abstract Syntax Tree (AST) Inspection**:
  - **Unauthenticated Route Gate**: Scans newly introduced API handlers and Server Actions to detect missing session or authentication checks.
  - **Client-Side Secret Leak Detector**: Inspects client component boundaries (`"use client"`) to flag exposed private API keys and database clients.
  - **Direct Client DB Access**: Detects ORM or direct database invocations imported inside client-rendered components.
- **Delta Risk Scoring**: Calculates a normalized 0 to 100 risk score weighted by vulnerability severity (Critical, High, Medium, Low) for every code push.

### 4. Root-Cause Incident Correlation
- **Time-Window Correlation**: Evaluates error rate surges starting within $X$ minutes of a deployment completion.
- **Route & Stack Fingerprinting**: Groups high-frequency runtime errors by normalizing stack frames and route paths.
- **Actionable Traceability**: Connects production incidents directly to the responsible commit SHA, author, and pull request.

---

## Monorepo Workspace Topology

The repository is organized as a `pnpm` monorepo separating infrastructure and runner processes from pure domain logic:

```text
ThirdEye/
├── apps/
│   ├── api/          # Webhook ingestion server (Express, TypeScript)
│   ├── worker/       # Event consumer and pipeline orchestrator
│   └── web/          # Observability dashboard (Next.js App Router, TailwindCSS)
│
├── packages/
│   ├── analysis/     # Pure AST parser, diff engine, and risk scorer
│   ├── queue/        # RabbitMQ connection manager, topology, and contracts
│   ├── database/     # PostgreSQL schema, migrations, and query clients
│   └── types/        # Shared domain models and canonical event interfaces
│
├── docs/             # Technical specifications and architectural deep dives
├── docker-compose.yml# Local infrastructure (PostgreSQL, RabbitMQ)
└── pnpm-workspace.yaml
```

---

## Tech Stack

| Domain | Technology | Rationale |
| :--- | :--- | :--- |
| **Monorepo** | pnpm Workspaces, TypeScript 5 | Strict workspace boundaries, shared types, fast builds |
| **API Ingestion** | Node.js, Express | Lightweight, low-latency HTTP request processing |
| **Worker Engine** | Node.js (Standalone Process) | Decoupled background processing with prefetch control |
| **Static Analysis** | TypeScript Compiler API | Native AST parsing without external dependencies |
| **Message Broker** | RabbitMQ (AMQP 0-9-1) | Durable queues, topic routing, native DLX support |
| **Primary Database** | PostgreSQL 16 | ACID transactions, strict relational consistency |
| **Frontend** | Next.js (App Router), React, Tailwind | Server components, real-time timeline visualization |

---

## Getting Started

### Prerequisites
- **Node.js**: v20 or higher
- **pnpm**: v9 or higher
- **Docker**: For running local PostgreSQL and RabbitMQ instances

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

# Optional: GitHub API Token (for higher rate limits in Worker)
GITHUB_TOKEN=your_personal_access_token
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

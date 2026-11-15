# ThirdEye

Developer-First AppSec, Deployment Observability, and Incident Correlation Platform.

---

## Overview

ThirdEye bridges the operational gap between **pull request security**, **code deployments**, and **production health**. Modern production incidents and security regressions are overwhelmingly introduced by new code pushes, database migrations, or configuration releases.

ThirdEye continuously monitors pull requests and deployments from GitHub and Vercel. It executes static application security testing (SAST) and software composition analysis (SCA) inside **zero-trust compartmentalized Docker sandboxes**, computes the **Differential Security Delta** (Base vs. Head revision), blocks regressions via an automated deployment gate, and reports real-time feedback back to GitHub.

---

## Key Highlights

- **Zero-Trust Compartmentalized Sandboxing**: Two-stage container execution separates network-enabled source fetching (`thirdeye-source-fetcher`) from an air-gapped, non-root, read-only scanning container (`thirdeye-scanner-runner` with `--network none`).
- **Differential Delta Analysis**: Ignores pre-existing technical debt on the target branch and focuses exclusively on **net-new security regressions** introduced in the pull request.
- **Automated Deployment Gate**: Evaluates risk scores using weighted severity scoring (Critical=10, High=5, Medium=2, Low=1) to deterministically output `BLOCK`, `WARN`, or `PASS`.
- **Dual-Channel GitHub Feedback**: Automatically posts Commit Statuses (`success`/`failure`) and rich Markdown summary dashboards to GitHub Pull Requests, supporting both GitHub Apps and standard Personal Access Tokens.
- **Air-Gapped Tooling**: Pre-caches Trivy vulnerability databases and OpenGrep SAST engines to run completely offline without external network dependencies.
- **Grounded AI Remediation (Planned Milestone 5)**: Post-gate asynchronous triage powered by Google Gemini (`gemini-2.5-flash`) to evaluate candidate reachability and synthesize ready-to-merge remediation patch diffs without delaying CI checks.
- **Reproducible Performance Benchmarking**: Built-in test harness (`scripts/benchmark.ts`) tracking monotonic execution durations, filesystem census, and memory usage across sequential and concurrent runs.

---

## Architecture Flow

```text
GitHub PR Event (opened / synchronize / reopened)
                      │
                      ▼
┌────────────────────────────────────────────────────────┐
│ apps/api: Fast Ingress Gateway (Express / Node.js)     │
│ • Supports application/json and form-urlencoded        │
│ • Validates payload & publishes to RabbitMQ            │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ packages/queue: AMQP Message Broker (RabbitMQ)         │
│ • Routing Key: deployment.github.pull_request          │
│ • Dead-Letter Safety: thirdeye.dlx -> DLQ              │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ apps/worker: Pipeline Orchestrator                     │
│ • Allocates isolated ephemeral workspace on disk       │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│ Stage 1: Source Fetcher   │ │ Stage 2: Scanner Runner  │
│ (thirdeye-source-fetcher) │ │ (thirdeye-scanner-runner)│
│ • Network: Bridge         │ │ • Network: none (offline)│
│ • Streams base & head     │ │ • User: 10001:10001      │
│   tarballs via GNU tar    │ │ • Runs OpenGrep & Trivy  │
└───────────────────────────┘ └───────────┬──────────────┘
                                          │
                                          ▼
                              ┌──────────────────────────┐
                              │ packages/analysis        │
                              │ • Computes SecurityDelta │
                              │ • Evaluates Gate Decision│
                              └───────────┬──────────────┘
                                          │
                       ┌──────────────────┴──────────────────┐
                       │ (Immediate Synchronous Path)        │ (Async Post-Gate)
                       ▼                                     ▼
       ┌──────────────────────────────┐       ┌──────────────────────────────┐
       │ GitHub Gate Feedback         │       │ Async AI Pipeline (Gemini)   │
       │ • Sets Commit Status (Fast)  │       │ • Grounded Semantic Triage   │
       │ • Posts Initial PR Comment   │◄──────┤ • Reachability Analysis      │
       └──────────────────────────────┘ (Appends│ • Patch Diff Synthesis      │
                                        Remediation)└────────────────────────┘
```

---

## Monorepo Layout

```text
thirdeye/
├── apps/
│   ├── api/             # Express webhook ingestion service (Port 4000)
│   ├── worker/          # RabbitMQ consumer & Docker sandbox orchestrator
│   ├── source-fetcher/  # Stage 1: Networked archive acquisition container
│   ├── scanner-runner/  # Stage 2: Air-gapped OpenGrep + Trivy sandbox container
│   └── web/             # Next.js observability dashboard (UI starter)
├── packages/
│   ├── analysis/        # Delta calculation, risk scoring, and GitHub formatters
│   ├── queue/           # RabbitMQ connection manager & channel wrappers
│   ├── database/        # PostgreSQL client & Prisma ORM schemas (Planned Phase 6)
│   └── types/           # Shared TypeScript domain contracts
└── scripts/
    └── benchmark.ts     # Pipeline performance and benchmarking runner
```

---

## Quickstart & Local Development

### Prerequisites

- **Node.js**: `v20.x` or later
- **pnpm**: `v9.x`
- **Docker Desktop**: With Linux containers enabled
- **RabbitMQ**: Running on port `5672` (or via `docker compose up -d rabbitmq`)

### 1. Install Dependencies

```powershell
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```powershell
cp .env.example .env
```

Ensure `.env` contains:
```ini
RABBITMQ_URL=amqp://thirdeye:thirdeye@localhost:5672
API_PORT=4000
GITHUB_TOKEN=your_personal_access_token_here
```

### 3. Build Docker Sandbox Images

Build the two sandboxed container images:

```powershell
# 1. Build Stage 1 (Source Fetcher)
docker build -f apps/source-fetcher/Dockerfile -t thirdeye-source-fetcher:latest .

# 2. Build Stage 2 (Scanner Runner)
docker build -f apps/scanner-runner/Dockerfile -t thirdeye-scanner-runner:latest .
```

### 4. Start Background Services

Open two terminals:

**Terminal 1 (Worker):**
```powershell
pnpm dev:worker
```

**Terminal 2 (API Gateway):**
```powershell
pnpm dev:api
```

---

## Testing Differential Analysis

Simulate a GitHub Pull Request event using PowerShell:

```powershell
$payload = @{
    action = "opened"
    repository = @{
        full_name = "facebook/react"
        clone_url = "https://github.com/facebook/react.git"
        default_branch = "main"
    }
    pull_request = @{
        number = 1
        base = @{ sha = "main" }
        head = @{ sha = "main" }
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:4000/api/webhooks/github" `
  -Method Post `
  -Headers @{ "X-GitHub-Event" = "pull_request" } `
  -Body $payload `
  -ContentType "application/json"
```

---

## Performance Benchmarking

ThirdEye includes a built-in benchmarking suite (`scripts/benchmark.ts`) to measure wall-clock durations, scanner execution times (OpenGrep vs. Trivy), filesystem census, and memory usage across sequential and concurrent runs:

```powershell
# Run default sequential benchmark (3 iterations across Express, Juice Shop, and ThirdEye)
pnpm benchmark

# Run concurrent benchmark with a worker pool of 3
pnpm tsx scripts/benchmark.ts --mode=concurrent --concurrency=3 --iterations=3

# Benchmark a specific local or remote repository
pnpm tsx scripts/benchmark.ts --repo=C:\Users\Hp\Desktop\ThirdEye --iterations=3
```

Benchmark runs generate:
- `benchmark-results.json`: Full environment specs, per-run timings, and statistical medians.
- `benchmark-report.md`: Executive summary table with median durations and min-max ranges.
- `benchmark-results.csv`: Flattened tabular export for spreadsheets.

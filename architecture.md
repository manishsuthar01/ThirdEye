# ThirdEye — Architecture & System Design

## 1. Executive Summary & Vision

**ThirdEye** is a developer-first **AppSec, deployment observability, and incident correlation platform** built specifically for modern full-stack web applications.

### The Problem
1. **The Deployment Blindspot**: When production applications break or experience error surges, the root cause is almost always a recent code push, configuration change, or deployment. Traditional APM tools isolate metrics and errors away from the developer's Git and deployment context.
2. **The AppSec Noise Problem in Pull Requests**: Fast-paced development frequently introduces critical security regressions (unauthenticated endpoints, broken authorization/IDOR, leaked secrets, and vulnerable dependencies). Existing security tools either spam developers with hundreds of legacy repository alerts or require complex, slow enterprise setups.
3. **The Sandbox Security Vulnerability**: Running untrusted pull request code or scanners directly on a shared worker filesystem risks cross-tenant contamination, disk exhaustion, and remote code execution (RCE) via malicious repositories or parser exploits.

### The Solution
ThirdEye bridges the gap between **code changes, application health, and pull request security**:
- **Compartmentalized Zero-Trust Execution**: Isolates source acquisition from security scanning using two separate ephemeral Docker containers per pull request: an unprivileged network-isolated scanner runner and a token-scoped source fetcher.
- **Differential Security Delta Engine**: Analyzes pull requests by scanning both **Base Revision** and **Head Revision**, categorizing findings into **New (Regressions)**, **Resolved (Fixed)**, and **Persistent (Existing Debt)**.
- **Automated Deployment Gate**: Evaluates security deltas using a weighted severity scoring model (Critical=10, High=5, Medium=2, Low=1) to deterministically output **BLOCK**, **WARN**, or **PASS**.
- **Dual-Channel Feedback Loop**: Publishes real-time gating verdicts directly to GitHub via the **Checks API** (for GitHub Apps) or automatic fallback to the **Commit Status API** and **Pull Request Review Comments** (for Personal Access Tokens).
- **Incident & Deployment Correlation**: Traces production error spikes directly to the exact deployment, commit SHA, and author responsible on a unified chronological timeline.

---

## 2. High-Level Architecture Diagram

```text
GitHub App / Vercel Webhooks
(PRs, Pushes, Deployments)
          │
          ▼
┌────────────────────────────────────────────────────────┐
│ apps/api: Ingress Gateway (Node.js / Express)          │
│ • HMAC SHA-256 Signature Verification                  │
│ • Webhook Event Normalization & Idempotency Gate       │
│ • Form-urlencoded & JSON Payload Auto-Unwrapping       │
│ • Non-Blocking Ingestion (HTTP 202 Accepted)           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ packages/queue: AMQP Message Broker (RabbitMQ)         │
│ • Topic Exchange: thirdeye.events                      │
│ • Routing Keys: deployment.github.#, error.#, etc.     │
│ • Dead-Letter Safety: thirdeye.dlx -> DLQ              │
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
              ▼                            ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ apps/worker: Orchestrator    │ │ Error & Correlation   │
│ • Receives PR Scan Job       │ │ Workers               │
│ • Manages Sandbox Lifecycle  │ │ • Error Grouping      │
│ • Ephemeral Workspace Backoff│ │ • Fingerprinting      │
│ • Enforces Timeouts & Limits │ │ • Time-Window Match   │
└─────────────┬────────────────┘ └───────────┬───────────┘
              │                              │
              ▼                              │
┌──────────────────────────────┐             │
│ Compartment 1: Source Fetcher│             │
│ (thirdeye-source-fetcher)    │             │
│ • Network-Enabled Bridge     │             │
│ • Public DNS Fallback        │             │
│ • Tarball Stream Extraction  │             │
└─────────────┬────────────────┘             │
              │ (Populates /workspace/base & head)
              ▼                              │
┌──────────────────────────────┐             │
│ Compartment 2: Scanner Runner│             │
│ (thirdeye-scanner-runner)    │             │
│ • AIR-GAPPED: --network none │             │
│ • Unprivileged: UID 10001    │             │
│ • Cap-Drop ALL, no-new-privs │             │
│ • Pre-Cached Trivy & OpenGrep│             │
└─────────────┬────────────────┘             │
              │ (Writes /out/results.json)   │
              ▼                              │
┌──────────────────────────────┐             │
│ packages/analysis: Delta     │             │
│ • O(N+M) Fingerprint Matching│             │
│ • Delta: New/Resolved/Debt   │             │
│ • Gate: BLOCK / WARN / PASS  │             │
└─────────────┬────────────────┘             │
              │                              │
              ▼                              │
┌──────────────────────────────┐             │
│ Feedback & Deployment Gate   │             │
│ • GitHub Check Run API       │             │
│ • Commit Status API (Fallback│             │
│ • PR Markdown Comment Report │             │
└──────────────────────────────┘             │
                                             ▼
                              ┌──────────────────────────┐
                              │ packages/database        │
                              │ • PostgreSQL / Prisma    │
                              │ • Repos, Scans, Incidents│
                              └──────────────────────────┘
```

---

## 3. The 4 Completed System Milestones

### Milestone 1: Ingress & Queueing Layer (`apps/api`, `packages/queue`)
- Express 5 REST API listening on port 4000.
- Webhook adapters for GitHub supporting `opened`, `synchronize`, and `reopened` pull request actions.
- Automatic payload unwrapper supporting both `application/json` and GitHub's `application/x-www-form-urlencoded` formats.
- RabbitMQ topic exchange publisher with dead-letter queue (DLQ) safety.

### Milestone 2: Compartmentalized Zero-Trust Sandboxing (`apps/source-fetcher`, `apps/scanner-runner`)
- **Stage 1 (`thirdeye-source-fetcher`)**: Network-enabled container that downloads repository archive snapshots directly from GitHub's tarball API, streaming them through GNU `tar` into an isolated workspace directory (`/workspace/base` and `/workspace/head`). Includes exponential retry loops and explicit DNS resolvers (`8.8.8.8`, `1.1.1.1`).
- **Stage 2 (`thirdeye-scanner-runner`)**: Strictly air-gapped container (`--network none`) running as non-root user `10001:10001`. Features pre-cached Trivy vulnerability databases and pre-compiled standalone OpenGrep binaries. Executes SAST and SCA scans concurrently across both revisions with zero network access.

### Milestone 3: Differential Security Delta Engine (`packages/analysis`)
- **Stable Fingerprinting**: Generates SHA-256 hashes (`SHA-256(ruleId + filePath + snippet)`) that resist line-drift false positives.
- **$O(N + M)$ Set Comparison**: Partitions findings into:
  - `new`: Regressions introduced in the pull request.
  - `resolved`: Pre-existing issues fixed by the pull request.
  - `persistent`: Unchanged baseline debt (does not block PRs).
  - `worsened`: Existing issues whose severity escalated.
- **Weighted Risk Scoring**:
  $$\text{Score} = (N_{\text{critical}} \times 10) + (N_{\text{high}} \times 5) + (N_{\text{medium}} \times 2) + (N_{\text{low}} \times 1) - (N_{\text{resolved}} \times 2)$$
- **Policy Gate**: Returns `BLOCK` if any critical/high regression is detected, `WARN` for medium regressions or score $\ge 4$, and `PASS` when no new regressions are introduced.

### Milestone 4: Feedback Loop & GitHub Checks Integration (`apps/worker`)
- Formats executive Markdown dashboards and line-level diff annotations.
- **Dual-Channel Reporting**:
  - Attempts the **GitHub Checks API** first.
  - Automatically falls back to the **Commit Status API** (setting red `❌ failure` on the commit) and the **PR Comments API** (posting the full Markdown summary table) when authenticating via Personal Access Tokens (PATs).

---

## 4. Next Development Phases

```text
Phase B: Persistence & Observability
├── Phase 1: Database Persistence (@thirdeye/database)
│   └── Persist Repositories, ScanJobs, Findings, and SecurityDeltas to PostgreSQL via Prisma.
├── Phase 2: Production Incident & Telemetry Ingestion
│   └── Ingest Vercel deployment events and runtime error telemetry (Sentry / OpenTelemetry).
├── Phase 3: Incident Correlation Engine
│   └── Correlate runtime error surges to deployment commit SHAs, authors, and time-windows.
└── Phase 4: Next.js Real-Time Observability Web Dashboard (@thirdeye/web)
    └── Visual timeline correlating deployments, security regressions, and production incidents.
```

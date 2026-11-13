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
       ┌──────┴──────────────────────┐       │
       │ (Immediate Path)            │ (Async│Job)
       ▼                             ▼       │
┌──────────────────────────────┐ ┌───────────┴──────────────────┐
│ Step 1: Immediate Gate       │ │ Step 2: Async Gemini Pipeline │
│ • Commit Status API (Fast)   │ │ • Grounded Semantic Triage    │
│ • Initial PR Check Comment   │ │ • Reachability Analysis       │
└──────────────┬───────────────┘ │ • Patch Diff Synthesis        │
               │                 └───────────┬───────────────────┘
               │ (Updates Comment with AI)   │
               ◄─────────────────────────────┘
                                             │
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
  - Automatically falls back to the **Commit Status API** (setting commit status to `failure`) and the **PR Comments API** (posting the full Markdown summary table) when authenticating via Personal Access Tokens (PATs).

---

## 4. Next Development Phases

### Milestone 5: AI-Assisted Security Investigation & Automated Remediation (Google Gemini)
- **Asynchronous Post-Gate Execution**: Runs asynchronously *after* the fast GitHub commit status and initial gate comment are published, preventing LLM latency or API timeouts from delaying CI/CD gating.
- **Provider & Model**: Powered by Google Gemini (`gemini-2.5-flash`) utilizing native structured output (`responseSchema`) for deterministic JSON payloads.
- **Grounded Semantic Triage**: Eliminates hallucinated findings by grounding analysis exclusively on deterministic candidate regressions emitted by Stage 2/3 (OpenGrep and Trivy).
- **Reachability Analysis**: Evaluates surrounding AST/call context to determine if untrusted user input actually reaches the flagged sink.
- **Contextual Exploit Path Explanation**: Synthesizes human-readable explanations tailored to the specific application framework (e.g. Next.js, Express, Prisma).
- **Automated Patch Generation**: Synthesizes ready-to-merge unified diffs that safely remediate the regression.
- **Comment Enrichment**: Asynchronously updates the PR comment (`PATCH /repos/:owner/:repo/issues/comments/:id`) with the synthesized explanation cards and remediation diffs.

### Milestone 6: Database Persistence & History (`packages/database`)
- Persist Repositories, ScanJobs, Findings, and SecurityDeltas to PostgreSQL via Prisma ORM.
- Track historical security posture, vulnerability resolution rates, and branch metrics over time.

### Milestone 7: Production Telemetry & Deployment Correlation
- Ingest Vercel deployment webhooks and runtime error telemetry (Sentry / OpenTelemetry).
- Group production exceptions using stack-frame hashing.
- Correlate error surges occurring within a post-deployment window directly to the offending commit SHA, author, and pull request.

### Milestone 8: Next.js Real-Time Observability Web Dashboard (`apps/web`)
- Unified web interface displaying live deployment feeds, security gate history, and incident correlation timelines.
- Real-time progress streaming for in-flight sandbox scanning jobs.

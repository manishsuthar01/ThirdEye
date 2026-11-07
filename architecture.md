# ThirdEye (DevPulse) — Architecture & System Design

## 1. Executive Summary & Vision

**ThirdEye** is a developer-first **AppSec, deployment observability, and incident correlation platform** built specifically for modern full-stack web applications.

### The Problem
1. **The Deployment Blindspot**: When production applications break or experience error surges, the root cause is almost always a recent code push, configuration change, or deployment. Traditional APM tools isolate metrics and errors away from the developer's Git and deployment context.
2. **The AppSec Noise Problem in Pull Requests**: AI-driven development ("vibecoding") produces code at unprecedented velocity, frequently introducing critical security regressions (unauthenticated endpoints, broken authorization/IDOR, leaked secrets, and vulnerable dependencies). Existing security tools either spam developers with hundreds of legacy repository alerts or require complex, slow enterprise setups.

### The Solution
ThirdEye bridges the gap between **code changes, application health, and pull request security**:
- **PR Security Impact Engine**: Analyzes pull requests by scanning both **Base Revision** and **Head Revision**, categorizing findings into **New (Regressions)**, **Resolved (Fixed)**, and **Persistent (Existing Debt)**.
- **Pragmatic Scanner Architecture**: Reuses proven open-source scanners (OpenGrep for SAST, Trivy for dependencies and secrets) behind modular adapters, focusing custom engineering where it matters: security delta comparison, resilient fingerprinting, and application-specific authorization analysis.
- **Incident & Deployment Correlation**: Traces production error spikes directly to the exact deployment, commit SHA, and author responsible for an incident on a unified chronological timeline.

---

## 2. High-Level Architecture Diagram

```text
GitHub App / Vercel
(PRs, Pushes, Deployments)
          │
          ▼
┌────────────────────────────────────────────────────────┐
│ ThirdEye API Server (Node.js / Express)                │
│ • HMAC SHA-256 Signature Verification                  │
│ • Webhook Event Normalization & Idempotency Gate       │
│ • Non-Blocking Ingestion (HTTP 202 Accepted)           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Message Broker Layer: RabbitMQ (AMQP 0-9-1)            │
│ • Topic Exchange: thirdeye.events                      │
│ • Routing Keys: deployment.#, error.#, incident.#      │
│ • Dead-Letter Safety: thirdeye.dlx -> failed_events_dlq│
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
              ▼                            ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ PR Security & Deployment     │ │ Error & Correlation   │
│ Worker Fleet (apps/worker)   │ │ Workers               │
│ • Workspace Manager (Git CLI)│ │ • Error Grouping      │
│ • Isolated Scanner Runner    │ │ • Fingerprinting      │
│   - OpenGrep (SAST)          │ │ • Time-Window Match   │
│   - Trivy (SCA + Secrets)    │ │ • Incident Generation │
└─────────────┬────────────────┘ └───────────┬───────────┘
              │                              │
              └──────────────┬───────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│ Intelligence & Comparison Engine (@thirdeye/analysis)  │
│ • Scanner Adapters (SARIF / JSON -> SecurityFinding)   │
│ • Resilient Fingerprinting (Line-drift tolerance)      │
│ • Security Delta Engine (Base vs. Head Diff)           │
│ • Future: Custom Cross-Layer Authorization Engine      │
└────────────────────────────┬───────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│ PostgreSQL Database (@thirdeye/database)               │
│ • Scan Result Cache (repoId, commitSHA, configHash)    │
│ • Normalized Findings, Security Deltas, Incidents      │
└────────────────────────────┬───────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ GitHub Checks API Dispatcher │ │ Observability UI      │
│ • PR Annotations & Summaries │ │ (apps/web - Next.js)  │
│ • Block / Warn on New Issues │ │ • Unified Timeline    │
└──────────────────────────────┘ └───────────────────────┘
```

---

## 3. Subsystem Breakdown

### 3.1. Integrations & Ingestion Gateway (`apps/api`)
- **GitHub App**:
  - Webhook listener for `pull_request` (`opened`, `synchronize`, `reopened`) and `push` events.
  - Publishes actionable scan summaries and code annotations directly onto pull requests via the **GitHub Checks API**.
- **Vercel Integration**:
  - Captures deployment states (`BUILDING`, `READY`, `ERROR`), commit SHAs, and environments.
- **Fast-Ingestion Design**:
  ```text
  Incoming Webhook ──► Validate HMAC ──► Normalize Event ──► Publish to RabbitMQ ──► HTTP 202 Accepted
  ```
  The API gatekeeper never executes scans or heavy database operations synchronously, ensuring sub-10ms response times and preventing webhook delivery timeouts.

---

### 3.2. Message Broker Layer (`packages/queue`)
- **Protocol**: AMQP 0-9-1 via `amqplib`.
- **Topic Exchange Topology (`thirdeye.events`)**:
  - `deployment.github.pull_request`
  - `deployment.github.push`
  - `deployment.vercel.succeeded`
  - `error.runtime`
  - `incident.detected`
- **Consumer Backpressure & Flow Control**:
  Workers configure explicit prefetch limits (`channel.prefetch(5)`) to prevent memory exhaustion when multiple pull requests or burst deployments trigger scans simultaneously.
- **Dead-Letter Exchange (`thirdeye.dlx`)**:
  Toxic or unrecoverable payloads are rejected with `requeue: false`, quarantining them into `thirdeye.failed_events_dlq` without blocking the worker fleet.

---

### 3.3. Worker Fleet & PR Security Scanner (`apps/worker`)

#### Build vs. Buy Technology Decisions
We deliberately avoid reinventing existing, solved open-source tools:

| Responsibility | Choice | Rationale |
| :--- | :--- | :--- |
| **SAST** | **OpenGrep** | Mature, fast Semgrep fork (LGPL-2.1), structural pattern matching, intrafile taint analysis, standard JSON/SARIF output. |
| **SCA (Dependencies)** | **Trivy** | Industry-standard lockfile and vulnerability database scanning. |
| **Secret Detection** | **Trivy** | Built-in repository secret and credential scanning without running a separate daemon. |
| **Git Operations** | **Git CLI** | Battle-tested, fast workspace checkout for Base and Head revisions. |
| **Core Orchestration** | **TypeScript / Node.js** | Unified language across the monorepo. |
| **Persistence** | **PostgreSQL** | ACID reliability for scan caching, finding deduplication, and relational history. |

#### Isolated Scanner Execution
Pull request code represents untrusted input:
1. Scanners execute in isolated, disposable environments with strict CPU and memory limits.
2. Source checkouts are mounted read-only (`ro`); scanner output directories are isolated.
3. Scanner environments run without elevated privileges and have no access to GitHub write tokens or internal network resources.
4. Static analysis runs without executing arbitrary repository build scripts (`npm install`, `build`).

---

### 3.4. Intelligence & Comparison Engine (`@thirdeye/analysis`)

This is where ThirdEye provides unique product value:

#### A. Scanner Adapters & Canonical Finding Schema
External scanner formats (OpenGrep SARIF, Trivy JSON) are isolated behind adapters. The rest of ThirdEye only consumes canonical `SecurityFinding` objects:

```typescript
export interface SecurityFinding {
  fingerprint: string;                  // Stable identifier resilient to line shifts
  ruleId: string;                       // e.g. "javascript.express.security.audit.xss"
  source: "opengrep" | "trivy";
  category: "sast" | "dependency" | "secret";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  location: {
    file: string;
    startLine?: number;
    endLine?: number;
  };
  remediation?: string;
  evidence: string[];                   // Redacted code snippets; raw secrets are NEVER persisted
}
```

#### B. Resilient Finding Fingerprinting
Line numbers drift as code is added or removed elsewhere in a file. To avoid falsely reporting an existing finding as "resolved" and "re-introduced", fingerprints are computed from immutable attributes:
$$\text{Fingerprint} = \text{Hash}(\text{ruleId} + \text{normalizedPath} + \text{sanitizedSinkOrSnippet})$$

#### C. Two-Snapshot Security Delta Comparison
A pull request is evaluated by comparing two snapshots:
```text
Base Revision Scan ─────┐
                        ├── Compare Fingerprints ──► Security Delta Report
Head Revision Scan ─────┘
```

The Delta Engine categorizes findings into four states:
1. **New (`new`)**: Vulnerabilities present in `Head` that did not exist in `Base` (Must be flagged/blocked).
2. **Resolved (`resolved`)**: Vulnerabilities present in `Base` that are no longer present in `Head` (Celebrated as fixes).
3. **Persistent (`persistent`)**: Pre-existing debt unchanged by this PR (Summarized without blocking).
4. **Worsened (`worsened`)**: Pre-existing issues whose severity or scope increased.

#### D. Aggressive Scan Result Caching
To optimize performance, scans are cached by composite key:
$$\text{CacheKey} = (\text{repositoryId}, \text{commitSHA}, \text{scannerVersion}, \text{rulesetVersion})$$
- When multiple PRs share the same `main` base commit, the Base scan is reused instantly.
- When an author pushes a new commit (`synchronize`), only the new Head commit is scanned.

---

### 3.5. Long-Term Core Goals & Advanced Capabilities

While the MVP focuses on reliable OpenGrep/Trivy orchestration and Delta analysis, ThirdEye’s roadmap includes high-value proprietary capabilities:

#### 1. Custom Cross-Layer Authorization Engine (Post-MVP)
Existing SAST scanners struggle with framework-specific authorization flows. Using the TypeScript Compiler API, ThirdEye will trace end-to-end data paths in full-stack applications:
```text
React Client Component ("use client")
    ↓
API Client (fetch / axios)
    ↓
Express / Next.js API Route Handler
    ↓
Authentication & Role Middleware
    ↓
Service / Controller
    ↓
Database ORM Query (Prisma / Drizzle / Mongoose)
    ↓
Tenant Ownership / Row-Level Validation
```
This detects **Broken Object Level Authorization (BOLA/IDOR)** and missing tenant filters that generic pattern-matchers cannot see.

#### 2. AI-Assisted Semantic Investigation (Post-MVP)
- **Role**: AI does not guess whether code is vulnerable; it investigates candidate findings produced by the deterministic engine.
- **Capabilities**: Explains attack vectors, suggests contextual code patches tailored to the repository's coding style, and correlates multiple medium findings into a single attack chain.

#### 3. Real-Time Deployment & Error Correlation
- Ingests production exceptions and HTTP 500s.
- Correlates error spikes within $X$ minutes of a deployment completion to the offending commit, author, and route.
- Displays a unified chronological timeline connecting deployments directly to production health.

---

## 4. End-to-End Pull Request Event Flow

```text
1. Developer opens or updates PR on GitHub
                       │
                       ▼
2. ThirdEye API verifies HMAC & acknowledges HTTP 202 Accepted
                       │
                       ▼
3. Enqueued to RabbitMQ "thirdeye.events" (deployment.github.pull_request)
                       │
                       ▼
4. Worker checks cache for Base SHA scan result:
   - Cache hit: Load base findings from PostgreSQL
   - Cache miss: Run OpenGrep & Trivy on Base workspace, cache results
                       │
                       ▼
5. Worker checks/runs OpenGrep & Trivy on Head workspace
                       │
                       ▼
6. Security Delta Engine (@thirdeye/analysis) diffs Base vs. Head findings
                       │
                       ▼
7. Results stored in PostgreSQL (commits, findings, deltas)
                       │
                       ▼
8. Worker calls GitHub Checks API:
   - Green Check: 0 new vulnerabilities (or resolved existing debt)
   - Actionable Annotations: Pinpoints exact lines of newly introduced security regressions
```

---

## 5. Implementation Roadmap

| Milestone | Deliverable | Focus Areas |
| :--- | :--- | :--- |
| **Milestone 1** | **PR Ingestion & Workspace Prep** | GitHub PR webhook adapter, RabbitMQ routing, Git CLI shallow snapshot retrieval for Base & Head. |
| **Milestone 2** | **Scanner Adapters (OpenGrep & Trivy)** | Adapter pattern, isolated container execution, SARIF and JSON raw output parsing. |
| **Milestone 3** | **Normalization & Security Delta** | Canonical `SecurityFinding` schema, resilient fingerprinting, Base vs. Head delta comparison. |
| **Milestone 4** | **GitHub Checks API Integration** | Publishing PR status checks, markdown summary reports, and in-line code annotations. |
| **Milestone 5** | **Custom Authorization Analysis** | TypeScript AST engine tracing Next.js/Express routes down to ORM queries for tenant boundary checks. |
| **Milestone 6** | **AI-Assisted Investigation** | Contextual explanations, attack path correlation, and automatic patch generation. |
| **Milestone 7** | **Deployment ↔ Error Correlation** | Production runtime error ingestion, stack trace fingerprinting, and unified incident timeline. |

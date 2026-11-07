# ThirdEye (DevPulse) — Architecture & System Design

## 1. Executive Summary & Vision

**ThirdEye** is a developer-first **AppSec, deployment observability, and incident correlation platform** built specifically for modern full-stack web applications.

### The Problem
1. **The Deployment Blindspot**: When production applications break or experience error surges, the root cause is almost always a recent code push, configuration change, or deployment. Traditional APM tools isolate metrics and errors away from the developer's Git and deployment context.
2. **The AppSec Noise Problem in Pull Requests**: AI-driven development ("vibecoding") produces code at unprecedented velocity, frequently introducing critical security regressions (unauthenticated endpoints, broken authorization/IDOR, leaked secrets, and vulnerable dependencies). Existing security tools either spam developers with hundreds of legacy repository alerts or require complex, slow enterprise setups.
3. **The Sandbox Security Vulnerability**: Running untrusted pull request code or scanners directly on a shared worker filesystem risks cross-tenant contamination, disk exhaustion, and remote code execution (RCE) via malicious repositories or parser exploits.

### The Solution
ThirdEye bridges the gap between **code changes, application health, and pull request security**:
- **Compartmentalized Zero-Trust Execution**: Isolates source acquisition from security scanning using two separate ephemeral containers per pull request: an unprivileged network-isolated scanner runner and a token-scoped source fetcher.
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
│ apps/worker: Orchestrator    │ │ Error & Correlation   │
│ • Receives PR Scan Job       │ │ Workers               │
│ • Manages Sandbox Lifecycle  │ │ • Error Grouping      │
│ • Enforces Timeouts & Cleanup│ │ • Fingerprinting      │
│ • Never executes untrusted   │ │ • Time-Window Match   │
│   repository code directly   │ │ • Incident Generation │
└─────────────┬────────────────┘ └───────────┬───────────┘
              │                              │
              ▼                              │
┌────────────────────────────────────────┐   │
│ Compartment 1: Source Fetcher Sandbox  │   │
│ • Short-lived, read-only GitHub token  │   │
│ • Downloads Base & Head archives       │   │
│ • Restricted egress; no scanner code   │   │
└─────────────┬──────────────────────────┘   │
              │                              │
              ▼ (Writes snapshots)           │
┌────────────────────────────────────────┐   │
│ Ephemeral Job Workspace                │   │
│ • Isolated directory: base/ and head/  │   │
│ • Explicit teardown after each job     │   │
└─────────────┬──────────────────────────┘   │
              │                              │
              ▼ (Mounted :ro)                │
┌────────────────────────────────────────┐   │
│ Compartment 2: Scanner Runner Sandbox  │   │
│ • STRICT NETWORK ISOLATION (--net none)│   │
│ • ZERO GitHub / DB / Broker credentials│   │
│ • Read-only rootfs; unprivileged user  │   │
│ • Pre-baked offline Trivy DB & OpenGrep│   │
│ • Runs SAST, SCA, and Secret detection │   │
│ • Emits bounded JSON findings to /out  │   │
└─────────────┬──────────────────────────┘   │
              │                              │
              ▼                              │
┌────────────────────────────────────────┐   │
│ Intelligence Engine (@thirdeye/analysis│   │
│ • Resilient Fingerprinting (anti-drift)│   │
│ • Security Delta: Base vs. Head Diff   │   │
│   -> { new, resolved, persistent }     │   │
│ • Future: Cross-Layer Auth AST Engine  │   │
└─────────────┬──────────────────────────┘   │
              │                              │
              └──────────────┬───────────────┘
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

## 3. The Compartmentalized Zero-Trust Sandbox Pattern

Running static analysis directly on the host or inside a network-connected container creates severe security vulnerabilities:
- **Exfiltration Risk**: If untrusted code exploits a vulnerability in a scanner or parser (e.g., buffer overflow in a C-based AST parser or regex engine), an internet-connected container can exfiltrate environment variables, source code, or internal tokens.
- **Credential Theft**: If the scanner container holds GitHub write tokens, malicious code can tamper with repository releases or secrets.

ThirdEye implements the **Compartmentalized Execution Pattern**, splitting source acquisition and scanning into two strictly bounded execution compartments:

```text
┌───────────────────────────────────┬───────────────────────────────────┐
│ Compartment 1: Source Fetcher     │ Compartment 2: Scanner Runner     │
├───────────────────────────────────┼───────────────────────────────────┤
│ Image: thirdeye-source-fetcher    │ Image: thirdeye-scanner-runner    │
│ Network: Restricted HTTPS Egress  │ Network: NONE (--network none)    │
│ Credentials: Short-lived Read-Only│ Credentials: ZERO CREDENTIALS     │
│ Code Execution: NEVER             │ Code Execution: Static Tools Only │
│ Input: GitHub Clone / Archive URL │ Input: /input (Mounted :ro)       │
│ Output: Raw snapshot files        │ Output: Bounded JSON finding file │
│ Privileges: Unprivileged non-root │ Privileges: cap-drop ALL, no-root │
└───────────────────────────────────┴───────────────────────────────────┘
```

### 3.1. Scanner Container Hardening Configuration
The scanner container executes with rigorous Linux kernel containment:

```bash
docker run --rm \
  --network none \
  --memory 1g \
  --cpus 1.0 \
  --pids-limit 256 \
  --read-only \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount type=bind,src="$JOB_INPUT",dst=/input,readonly \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --tmpfs /out:rw,nosuid,nodev,size=64m \
  thirdeye-scanner@sha256:<PINNED_DIGEST>
```

| Flag | Purpose |
| :--- | :--- |
| `--rm` | Automatically removes the container instance and its writable layer upon exit. |
| `--network none` | Completely closes network interfaces (only loopback `lo` is present). Prevents data exfiltration. |
| `--memory 1g`, `--cpus 1.0` | Prevents Denial-of-Service via algorithmic complexity attacks (e.g. ReDoS in custom rules). |
| `--pids-limit 256` | Prevents fork-bombs from exhausting host process tables. |
| `--read-only` | Mounts the container root filesystem as read-only. Malware cannot write to `/bin`, `/usr`, or `/lib`. |
| `--user 10001:10001` | Runs as a dedicated non-root UID/GID inside the container. |
| `--cap-drop ALL` | Strips all Linux kernel capabilities (e.g., `CAP_NET_RAW`, `CAP_SYS_ADMIN`, `CAP_CHOWN`). |
| `no-new-privileges:true` | Prevents processes from gaining additional privileges via `setuid` binaries. |
| `dst=/input,readonly` | Ensures the repository source code cannot be tampered with or modified during the scan. |
| `--tmpfs /out:...,size=64m` | Provides a bounded in-memory scratchpad for scan outputs, protecting host disks. |

---

### 3.2. Offline Database & Rules Strategy
Because `--network none` disables internet access, scanners cannot perform runtime updates. ThirdEye addresses this deterministically:
1. **Pinned Scanner Image**: An automated maintenance pipeline periodically pulls the latest Trivy vulnerability database (`trivy image --download-db-only`) and pinned OpenGrep rulesets into the base image.
2. **Offline Execution**:
   - Trivy is invoked with `--skip-db-update --offline-scan`.
   - OpenGrep runs with pre-bundled, versioned rule packs.
3. **Reproducibility**: Eliminates non-deterministic scan results where the same commit flags different vulnerabilities hours apart due to unannounced external database syncs.
4. **Freshness Verification**: The runner reports its database timestamp. If the local database is older than a configurable threshold (e.g. 48 hours), the worker reports a scanner-stale warning rather than silently passing.

---

### 3.3. Intelligence & Comparison Engine (`@thirdeye/analysis`)

#### A. Finding Normalization & Resilient Fingerprinting
External scanner outputs (OpenGrep SARIF, Trivy JSON) are mapped into ThirdEye's canonical schema. To prevent line-drift false positives when surrounding code changes:
$$\text{Fingerprint} = \text{SHA256}(\text{ruleId} + \text{normalizedPath} + \text{sanitizedSinkOrSnippet})$$

#### B. Two-Snapshot Security Delta Comparison
A pull request is evaluated by diffing `BaseFindings` against `HeadFindings`:
1. **New (`new`)**: Vulnerabilities present in `Head` that did not exist in `Base` (Regressions that block or warn on PR).
2. **Resolved (`resolved`)**: Vulnerabilities present in `Base` that are no longer in `Head` (Fixed debt).
3. **Persistent (`persistent`)**: Pre-existing debt unchanged by this PR (Summarized without blocking).
4. **Worsened (`worsened`)**: Pre-existing issues whose severity or scope increased.

#### C. Aggressive Scan Result Caching
Scans are indexed by composite cache key:
$$\text{CacheKey} = \text{Hash}(\text{repositoryId} + \text{commitSHA} + \text{scannerVersion} + \text{rulesetHash})$$
- Base commits shared across multiple PRs target branches are scanned only once.
- On commit updates (`synchronize`), only the new Head commit requires scanning.

---

### 3.4. Long-Term Proprietary Engines (Post-MVP)

1. **Custom Cross-Layer Authorization Engine (Phase 5)**:
   - Built directly on the TypeScript Compiler API.
   - Traces data flow from Client Components $\to$ API routes $\to$ Middleware $\to$ Controllers $\to$ ORM queries.
   - Detects Broken Object Level Authorization (BOLA/IDOR) by verifying that ID-filtered database queries enforce tenant/user ownership constraints.
2. **AI Semantic Investigation (Phase 6)**:
   - Does not perform unassisted vulnerability guesswork.
   - Investigates deterministic candidate findings, constructs multi-step exploit chains, and synthesizes ready-to-merge patches.
3. **Runtime Deployment ↔ Error Correlation (Phase 7)**:
   - Ingests production exceptions and HTTP 500s.
   - Correlates error spikes within $X$ minutes of deployment to the offending commit, author, and route on a unified chronological timeline.

---

## 4. Phased Implementation Roadmap

| Milestone | Deliverable | Focus Areas |
| :--- | :--- | :--- |
| **Milestone 1** | **PR Ingestion & Compartmentalized Workspace** | PR webhook adapter, RabbitMQ routing, Source Fetcher container, and isolated job workspace lifecycle. |
| **Milestone 2** | **Isolated Scanner Runner** | Hardened container runtime (`--network none`, non-root), offline OpenGrep & Trivy execution, and SARIF/JSON parsing. |
| **Milestone 3** | **Normalization & Security Delta** | Canonical `SecurityFinding` schema, resilient fingerprinting, Base vs. Head delta comparison, and snapshot caching. |
| **Milestone 4** | **GitHub Checks API Integration** | Publishing PR status checks, markdown summary reports, and in-line code annotations. |
| **Milestone 5** | **Custom Authorization Analysis** | TypeScript AST engine tracing Next.js/Express routes down to ORM queries for tenant boundary checks. |
| **Milestone 6** | **AI-Assisted Investigation** | Contextual explanations, attack path correlation, and automatic patch generation. |
| **Milestone 7** | **Deployment ↔ Error Correlation** | Production runtime error ingestion, stack trace fingerprinting, and unified incident timeline. |

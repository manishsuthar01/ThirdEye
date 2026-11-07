# ThirdEye — Worker Architecture & PR Security Pipeline Specification

> **North Star Vision**: Vibecoded applications are built at incredible speed using AI generators (Cursor, Claude, v0, Bolt, Lovable), but frequently introduce critical security regressions—such as unauthenticated endpoints, broken authorization (BOLA/IDOR), client-side secret exposure, and vulnerable packages.
>
> **ThirdEye's Mission**: Provide an automated, zero-configuration security guardian that inspects every Pull Request, runs battle-tested scanners (OpenGrep, Trivy) behind isolated adapters, computes the **Security Delta** (Base vs. Head), and surfaces actionable findings directly via GitHub Checks.

---

## 1. High-Level System Architecture

```text
                  ┌──────────────────────────────────────────────┐
                  │            GitHub Webhook Ingestion          │
                  │   POST /api/webhook/github (API Service)     │
                  │   Events: pull_request (opened, sync, reopen)│
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       RabbitMQ: "thirdeye.events"            │
                  │       Routing Key: deployment.github.pr      │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │         Queue: "deployments_queue"           │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ThirdEye Worker Fleet                           │
│                                                                        │
│  1. Ingress & Deserialization (queueManager.createConsumer)            │
│  2. Workspace Snapshot Manager (Git CLI): Base SHA & Head SHA          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Scanner Runner (Disposable, Isolated Container Execution)        │  │
│  ├──────────────────────────────────┬───────────────────────────────┤  │
│  │ OpenGrep Adapter                 │ Trivy Adapter                 │  │
│  │ • Structural pattern matching    │ • Dependency lockfile scanning│  │
│  │ • Intrafile taint analysis       │ • Secret & credential leaks   │  │
│  │ • Emits raw SARIF / JSON         │ • Emits raw JSON              │  │
│  └──────────────────────────────────┴───────────────────────────────┘  │
│                                  │                                     │
│  3. Finding Normalizer & Fingerprinter (@thirdeye/analysis)            │
│     - Translates raw outputs into canonical SecurityFinding[]          │
│     - Hashes ruleId + normalizedPath + codeSink to avoid line drift    │
│                                  │                                     │
│  4. Security Delta Engine (@thirdeye/analysis)                         │
│     - Diff Base findings vs. Head findings                             │
│     - Categorizes: New (Regressions), Resolved, Persistent, Worsened   │
│     - Caches snapshots: (repoId, commitSHA, configHash)                │
│                                  │                                     │
│  5. Results Dispatcher & Reporter                                      │
│     - Persist scans and deltas to PostgreSQL (@thirdeye/database)       │
│     - Post Checks report and annotations to GitHub Checks API          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Long-Term Proprietary Engines (Phases 5 & 6)                     │  │
│  ├──────────────────────────────────┬───────────────────────────────┤  │
│  │ Custom Cross-Layer Auth Engine   │ AI Semantic Investigation     │  │
│  │ (TypeScript Compiler AST)        │ (Contextual Explanation)      │  │
│  │ • Client -> Route -> ORM Tracing │ • Attack path investigation   │  │
│  │ • Deep BOLA / IDOR detection     │ • Custom patch generation     │  │
│  └──────────────────────────────────┴───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. In-Depth Component Breakdown

### 2.1. The Consumer Layer (`apps/worker`)
The worker runs as an independent long-lived Node.js process decoupled from the HTTP API server.

* **Queue Subscription**: Listens to `deployments_queue` bound to `deployment.#`.
* **Flow Control & Backpressure**: Configured with `channel.prefetch(5)` to prevent memory exhaustion when a busy repository pushes multiple commits simultaneously.
* **Dead-Letter Handling**: If a message fails due to an unrecoverable payload or bug, it is rejected without requeue (`requeue: false`), routing it to `thirdeye.dlx` ➔ `failed_events_dlq` for forensic inspection.

---

### 2.2. Isolated Scanner Runner & Adapter Architecture
Pull request code is untrusted. We run open-source scanners in isolated, ephemeral environments:
- **Zero Elevated Privileges**: Runs as a non-root, unprivileged process.
- **Read-Only Source Mounts**: The repository workspace is mounted strictly read-only (`ro`); scanner output directories are isolated.
- **No Arbitrary Script Execution**: Static analysis does not run `npm install` or execute repository scripts.

#### The Scanner Adapter Pattern
ThirdEye depends only on its internal finding contracts, never on specific scanner output formats:

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

export interface ScannerAdapter {
  name: string;
  run(workspacePath: string): Promise<SecurityFinding[]>;
}
```

---

### 2.3. The Security Delta Engine & Resilient Fingerprinting

#### The Problem with Line-Based Diffing
If a developer adds 10 lines of comments at the top of a file, every finding below it shifts by 10 lines. A naive comparison tool would report every existing issue as "resolved at line 20" and "new at line 30", creating unbearable notification spam.

#### Fingerprinting Solution
Fingerprints are computed from stable code identity rather than raw line numbers:
$$\text{Fingerprint} = \text{SHA256}(\text{ruleId} + \text{normalizedRelativePath} + \text{sanitizedSinkOrSnippet})$$

#### Four-State Delta Model
By comparing `BaseFindings` with `HeadFindings`:
1. **New (`new`)**: Present in Head, absent in Base. **These are newly introduced regressions that block or warn on the PR.**
2. **Resolved (`resolved`)**: Present in Base, absent in Head. **These are existing vulnerabilities that the PR successfully fixed.**
3. **Persistent (`persistent`)**: Present in both Base and Head. **Pre-existing technical debt. Not blamed on this PR.**
4. **Worsened (`worsened`)**: Pre-existing issues whose severity or scope increased.

#### Aggressive Scan Caching
```text
CacheKey = Hash(repositoryId + commitSHA + scannerVersion + rulesetVersion)
```
- If another PR targets the same `main` base commit, its Base scan is fetched instantly from PostgreSQL.
- If a PR author pushes another commit (`synchronize`), only the new Head commit is scanned.

---

### 2.4. Long-Term Engine: Custom Cross-Layer Authorization Engine (Phase 5)

While OpenGrep handles standard pattern matching and intrafile taint analysis, it cannot easily follow framework-specific authorization flows across files.

In Phase 5, ThirdEye’s proprietary differentiator is a **Cross-Layer AST Tracer** built using the native TypeScript Compiler API (`typescript`):

```text
React Client Component ("use client")
    ↓
API Client (fetch / axios)
    ↓
Express / Next.js API Route Handler (app/api/...)
    ↓
Authentication Guard (getServerSession / auth())
    ↓
Controller / Service Function
    ↓
ORM Query (prisma.doc.findUnique / db.select)
    ↓
Tenant Ownership Filter ({ where: { id, userId: session.user.id } })
```

#### Why AST Tracing Outperforms Regex
- **Zero Hallucinations**: Parses exact syntax semantics, scopes, and symbol references.
- **BOLA / IDOR Detection**: Verifies that every database mutation or read query filtered by an object ID also includes an active tenant/user ownership constraint.

---

### 2.5. Long-Term Engine: AI Semantic Investigation (Phase 6)

AI does not guess whether code is vulnerable; it investigates candidate findings produced by the deterministic engine:
1. **Evidence Correlation**: Combines multiple medium-severity findings into an end-to-end exploit scenario.
2. **Context-Aware Remediation**: Generates ready-to-merge patches formatted specifically to match the project's coding conventions.
3. **Attack Path Explanation**: Explains in plain English how an attacker could leverage the detected flow.

---

## 3. Database Schema Design (`packages/database`)

```sql
-- Tracked Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    default_branch VARCHAR(100) DEFAULT 'main',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scan Cache (Commit-Level Snapshots)
CREATE TABLE scan_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    scanner_name VARCHAR(50) NOT NULL,
    scanner_version VARCHAR(50) NOT NULL,
    ruleset_hash VARCHAR(64) NOT NULL,
    raw_findings JSONB NOT NULL,
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, commit_sha, scanner_name, ruleset_hash)
);

-- Pull Request Analyses
CREATE TABLE pull_request_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    pr_number INT NOT NULL,
    base_sha VARCHAR(40) NOT NULL,
    head_sha VARCHAR(40) NOT NULL,
    status VARCHAR(30) NOT NULL, -- 'PENDING' | 'COMPLETED' | 'FAILED'
    new_findings_count INT DEFAULT 0,
    resolved_findings_count INT DEFAULT 0,
    persistent_findings_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Normalized Security Findings (Per Analysis)
CREATE TABLE security_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID REFERENCES pull_request_analyses(id) ON DELETE CASCADE,
    fingerprint VARCHAR(64) NOT NULL,
    rule_id VARCHAR(255) NOT NULL,
    source VARCHAR(50) NOT NULL, -- 'opengrep' | 'trivy' | 'thirdeye_auth'
    category VARCHAR(50) NOT NULL, -- 'sast' | 'dependency' | 'secret'
    severity VARCHAR(20) NOT NULL, -- 'critical' | 'high' | 'medium' | 'low' | 'info'
    delta_status VARCHAR(20) NOT NULL, -- 'new' | 'resolved' | 'persistent' | 'worsened'
    file_path TEXT NOT NULL,
    start_line INT,
    end_line INT,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    evidence TEXT[],
    remediation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_scan_cache ON scan_snapshots(project_id, commit_sha);
CREATE INDEX idx_findings_analysis ON security_findings(analysis_id);
CREATE INDEX idx_findings_fingerprint ON security_findings(fingerprint);
```

---

## 4. Educational Guide: Key Principles

### 4.1. AMQP Reliability & Idempotent Worker Processing
- **At-least-once Delivery**: RabbitMQ guarantees delivery, meaning consumers must be idempotent.
- **Handling Restarts**: If a worker crashes midway through a scan, the unacknowledged message returns to the queue and is retried.
- **Dead-Letter Safety (`thirdeye.dlx`)**: Toxic messages that trigger fatal crashes are rejected (`requeue = false`) and diverted to the dead-letter queue, preventing infinite crash-restart loops.

### 4.2. SARIF (Static Analysis Results Interchange Format)
Both OpenGrep and GitHub Checks natively use **SARIF** (OASIS standard JSON format). Understanding SARIF:
- `runs[].tool.driver.rules`: Definition of rules and severity.
- `runs[].results[]`: Finding instances referencing `ruleId`, `message`, and physical `locations[].physicalLocation.artifactLocation.uri`.

Our normalizer consumes SARIF and standardizes it into our clean, lightweight `SecurityFinding` interface.

---

## 5. Phased Implementation Roadmap

| Milestone | Deliverable | Focus Areas |
| :--- | :--- | :--- |
| **M1: Ingestion & Workspace** | PR Webhook & Git Snapshot | PR webhook adapter, RabbitMQ routing, Base & Head shallow retrieval. |
| **M2: Scanner Adapters** | OpenGrep & Trivy Runner | Containerized execution, SARIF & JSON output parsing into `SecurityFinding[]`. |
| **M3: Delta Engine & Cache** | Fingerprinting & Comparison | Stable fingerprinting, snapshot caching, Base vs. Head delta classification. |
| **M4: GitHub Checks API** | PR Feedback Loop | Check runs, status annotations, and PR markdown summaries. |
| **M5: Custom Auth Engine** | Deep Full-Stack AST Tracing | Cross-layer AST tracking for BOLA/IDOR and unauthenticated route detection. |
| **M6: AI Semantic Engine** | Contextual Investigation | AI investigation of candidate findings and patch generation. |
| **M7: Runtime Correlation** | Deployment ↔ Incident Link | Correlating production error surges to deployment timelines. |

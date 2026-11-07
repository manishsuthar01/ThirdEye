# ThirdEye — Worker Architecture & PR Security Pipeline Specification

> **North Star Vision**: Vibecoded applications are built at incredible speed using AI generators (Cursor, Claude, v0, Bolt, Lovable), but frequently introduce critical security regressions—such as unauthenticated endpoints, broken authorization (BOLA/IDOR), client-side secret exposure, and vulnerable packages.
>
> **ThirdEye's Mission**: Provide an automated, zero-configuration security guardian that inspects every Pull Request, executes battle-tested scanners in zero-trust isolated sandboxes, computes the **Security Delta** (Base vs. Head), and surfaces actionable findings directly via GitHub Checks.

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
│  2. Job Lifecycle Manager: Provisions ephemeral host workspace         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Compartment 1: Source Fetcher Container                          │  │
│  │ • Restricted HTTPS egress to GitHub API only                     │  │
│  │ • Receives short-lived, read-only installation token             │  │
│  │ • Downloads Base SHA & Head SHA archives                         │  │
│  │ • Writes to ephemeral workspace: /workspace/{base,head}          │  │
│  │ • Exits and self-destructs                                       │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│                                     ▼ (Workspace mounted :ro)          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Compartment 2: Scanner Runner Container                          │  │
│  │ • STRICT NETWORK ISOLATION (--network none)                      │  │
│  │ • ZERO GitHub / DB / RabbitMQ credentials                        │  │
│  │ • Read-only root filesystem, unprivileged user (UID 10001)       │  │
│  │ • OpenGrep (SAST & taint analysis) via pinned rule packs         │  │
│  │ • Trivy (SCA & Secrets) using preloaded offline vulnerability DB │  │
│  │ • Emits bounded JSON findings to temporary in-memory volume      │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  3. Finding Normalizer & Fingerprinter (@thirdeye/analysis)            │
│     - Translates raw outputs into canonical SecurityFinding[]          │
│     - Hashes ruleId + normalizedPath + codeSink to avoid line drift    │
│                                     │                                  │
│  4. Security Delta Engine (@thirdeye/analysis)                         │
│     - Diff Base findings vs. Head findings                             │
│     - Categorizes: New (Regressions), Resolved, Persistent, Worsened   │
│     - Caches snapshots: (repoId, commitSHA, configHash)                │
│                                     │                                  │
│  5. Results Dispatcher & Reporter                                      │
│     - Persist scans and deltas to PostgreSQL (@thirdeye/database)       │
│     - Post Checks report and annotations to GitHub Checks API          │
│     - Explicitly destroys ephemeral host workspace                     │
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

### 2.1. The Compartmentalized Execution Pattern
Running untrusted code or complex third-party parsers inside a privileged environment is an unacceptable security risk. ThirdEye implements two distinct execution boundaries:

#### Compartment 1: Source Fetcher (`apps/source-fetcher`)
- **Mission**: Obtain the exact source code trees for `baseSha` and `headSha`.
- **Network**: Egress strictly to GitHub API.
- **Credentials**: Short-lived, read-only GitHub App Installation Token.
- **Security Boundary**: Does not execute compilers, linters, or repository scripts. Downloads clean archives and extracts them into `/workspace/base` and `/workspace/head`.

#### Compartment 2: Scanner Runner (`apps/scanner-runner`)
- **Mission**: Perform static analysis, secret detection, and dependency audits.
- **Network**: **Strictly none (`--network none`)**.
- **Credentials**: **Zero credentials**.
- **Hardening Flags**:
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
    --mount type=bind,src="$JOB_WORKSPACE",dst=/input,readonly \
    --tmpfs /tmp:rw,nosuid,nodev,size=128m \
    --tmpfs /out:rw,nosuid,nodev,size=64m \
    thirdeye-scanner@sha256:<PINNED_DIGEST>
  ```

---

### 2.2. Offline Database & Rules Strategy
Because `--network none` disables internet access, scanners cannot perform runtime updates.
- **Trivy Database Preloading**: Trivy’s vulnerability database (`trivy-db`) is packaged inside the base container image during an automated nightly build. At runtime, Trivy runs with `--skip-db-update --offline-scan`.
- **OpenGrep Rules Bundling**: All OpenGrep rules are pinned and bundled inside the image.
- **Benefits**:
  - Deterministic scan results (identical commit yields identical findings every time).
  - Immunity to external server downtimes and rate limits.
  - Sub-second scan startup time.

---

### 2.3. Resilient Finding Fingerprinting
To prevent line shifts (from added lines above a finding) from falsely reporting existing findings as "resolved" and "new":
$$\text{Fingerprint} = \text{SHA256}(\text{ruleId} + \text{normalizedRelativePath} + \text{sanitizedSinkOrSnippet})$$

---

### 2.4. Two-Snapshot Security Delta Comparison
The Delta Engine diffs `baseFindings` against `headFindings`:
1. **New (`new`)**: Present in Head, absent in Base (Regressions that trigger PR blocks/warnings).
2. **Resolved (`resolved`)**: Present in Base, absent in Head (Vulnerabilities fixed by this PR).
3. **Persistent (`persistent`)**: Present in both Base and Head (Pre-existing debt).
4. **Worsened (`worsened`)**: Pre-existing issues whose severity or scope increased.

---

### 2.5. Long-Term Engine: Custom Cross-Layer Authorization Engine (Phase 5)
While OpenGrep handles standard pattern matching, it cannot trace authorization across distributed application boundaries. In Phase 5, ThirdEye’s differentiator is a **Cross-Layer AST Tracer**:
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

---

### 2.6. Long-Term Engine: AI Semantic Investigation (Phase 6)
AI investigates candidate findings produced by the deterministic engine:
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

## 4. Phased Implementation Roadmap

| Milestone | Deliverable | Focus Areas |
| :--- | :--- | :--- |
| **M1: Ingestion & Compartmentalized Workspace** | PR Webhook & Source Fetcher | PR webhook adapter, RabbitMQ routing, Source Fetcher container, and ephemeral workspace manager. |
| **M2: Isolated Scanner Runner** | Hardened Scanner Container | Hardened container runtime (`--network none`, non-root), offline OpenGrep & Trivy execution, and SARIF/JSON parsing. |
| **M3: Delta Engine & Cache** | Fingerprinting & Comparison | Stable fingerprinting, snapshot caching, Base vs. Head delta classification. |
| **M4: GitHub Checks API Integration** | PR Feedback Loop | Check runs, status annotations, and PR markdown summaries. |
| **M5: Custom Auth Engine** | Deep Full-Stack AST Tracing | Cross-layer AST tracking for BOLA/IDOR and unauthenticated route detection. |
| **M6: AI Semantic Engine** | Contextual Investigation | AI investigation of candidate findings and patch generation. |
| **M7: Runtime Correlation** | Deployment ↔ Incident Link | Correlating production error surges to deployment timelines. |

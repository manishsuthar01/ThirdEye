# ThirdEye — Worker Architecture & Security Analysis Pipeline Specification

> **North Star Vision**: Vibecoded applications are built at incredible speed using AI generators (Cursor, Claude, v0, Bolt, Lovable), but frequently introduce critical security vulnerabilities—such as unauthenticated endpoints, broken authorization (BOLA/IDOR), client-side secret exposure, and missing row-level protections.
>
> **ThirdEye's Mission**: Provide an automated, zero-configuration security guardian that inspects every Git commit in real-time, calculates a **Delta Risk Score**, and pinpoints exact security regressions with actionable fixes.

---

## 1. High-Level System Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │          GitHub Webhook Ingestion            │
                  │   POST /api/webhook/github (API Service)     │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       RabbitMQ: "thirdeye.events"            │
                  │       Routing Key: deployment.github.push    │
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
│  2. Git Diff Extraction (GitHub Compare API / Unified Diff)            │
│                                                                        │
│  ┌───────────────────────────────┬──────────────────────────────────┐  │
│  │ Track 1: Deterministic Engine │ Track 2: AI Semantic Engine      │  │
│  │ (Abstract Syntax Tree - AST)  │ (LLM Contextual Diff Review)     │  │
│  ├───────────────────────────────┼──────────────────────────────────┤  │
│  │ • Unauthenticated Route Gate  │ • Broken Object Auth (BOLA/IDOR) │  │
│  │ • Client Secret Leaks         │ • Business Logic Bypass          │  │
│  │ • Direct DB from Client Comp  │ • Privilege Escalation           │  │
│  │ • Deterministic & Instant     │ • Context-Aware & Deep           │  │
│  └───────────────────────────────┴──────────────────────────────────┘  │
│                                  │                                     │
│  3. Delta Risk Calculator (Security Score: 0 - 100%)                   │
│  4. PostgreSQL Persistence Layer (@thirdeye/database)                  │
│  5. Real-Time Alerting (Incident / Webhook / PR Comment)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. In-Depth Component Breakdown

### 2.1. The Consumer Layer (`apps/worker`)
The worker runs as an independent long-lived Node.js process decoupled from the HTTP API server.

* **Queue Subscription**: Listens to `deployments_queue` bound to `deployment.#`.
* **Flow Control & Backpressure**: Configured with `channel.prefetch(5)` to prevent memory exhaustion when a large repo pushes multiple branches simultaneously.
* **Dead-Letter Handling**: If a message fails due to an unrecoverable bug, it is rejected without requeue (`requeue: false`), routing it to `thirdeye.dlx` ➔ `failed_events_dlq` for forensic inspection.

---

### 2.2. Track 1: Deterministic Security Engine (AST Analysis)

#### Why AST (Abstract Syntax Tree) Over Regular Expressions?
Regular expressions fail when analyzing code because they cannot understand syntax semantics:
* Regex gets tricked by comments: `// const key = "secret"` triggers false positives.
* Regex breaks across line breaks and formatting variations.
* Regex has no understanding of **scope** or **call hierarchies**.

An **Abstract Syntax Tree (AST)** parses source text into a structured tree of nodes (`ImportDeclaration`, `FunctionDeclaration`, `CallExpression`, `Identifier`), allowing 100% deterministic, zero-hallucination code queries.

#### Zero External Libraries: The Native TypeScript Compiler API
TypeScript includes a built-in compiler parser accessible directly via `typescript`:

```typescript
import ts from "typescript";

// Parse code into an Abstract Syntax Tree in memory (< 2ms)
const sourceFile = ts.createSourceFile(
  "app/api/billing/route.ts",
  fileContent,
  ts.ScriptTarget.Latest,
  true // setParentNodes
);

// Traverse every node in the AST
function inspectNode(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
    // Check if this is an exported HTTP handler (GET, POST, DELETE)
    // Check if any of its child expressions call auth() or getServerSession()
  }
  ts.forEachChild(node, inspectNode);
}
inspectNode(sourceFile);
```

#### Deterministic Check #1: The Unauthenticated Route Gate
* **The Problem in Vibecoding**: AI generates a new mutation route (e.g. `POST /api/delete-account` or Next.js Server Action) and directly calls Prisma/Drizzle without checking the active session.
* **AST Detection Logic**:
  1. Identifies file path matching `app/api/**/route.ts` or `pages/api/**` or functions with `"use server"`.
  2. Detects exported HTTP handlers: `POST`, `PUT`, `DELETE`, `PATCH`.
  3. Inspects function body AST:
     - **Positive trigger**: Calls to database mutation functions (`prisma.*.delete`, `db.delete`, `sql` queries).
     - **Negative trigger (Deficiency)**: No preceding call to an authorization guard (e.g., `getServerSession()`, `auth()`, `verifyToken()`, `requireAuth()`).
  4. Flagged Severity: **CRITICAL**.

#### Deterministic Check #2: Client-Side Secret & Environment Exposure
* **The Problem in Vibecoding**: Developers prompt the AI with: *"Use my Stripe secret key to create a checkout session"*, and the AI writes the secret into a client component or names it `NEXT_PUBLIC_STRIPE_SECRET`.
* **AST Detection Logic**:
  1. Inspects if file contains `"use client"` directive or is located in client directories (`components/`, `views/`).
  2. AST searches for `MemberExpression`:
     - Checks `process.env[key]`.
     - Flags any key starting with `NEXT_PUBLIC_` containing substrings: `SECRET`, `PRIVATE`, `TOKEN`, `KEY`, `PASSWORD`.
  3. Searches for direct imports of database clients (`@prisma/client`, `@thirdeye/database`, `drizzle-orm`) inside client files.
  4. Flagged Severity: **CRITICAL**.

---

### 2.3. Track 2: AI-Based Semantic Analysis Engine (LLM Review)

#### Why Deterministic Analysis Alone is Not Enough
Deterministic AST rules cannot detect **Business Logic Flaws** or **Broken Object Level Authorization (BOLA/IDOR)**.

* **Example BOLA Vulnerability**:
  ```typescript
  // The AST sees that session exists (auth is present), BUT:
  const session = await auth();
  const document = await db.documents.findUnique({
    where: { id: req.params.id } // ❌ BOLA: Missing where: { ownerId: session.user.id }
  });
  return res.json(document);
  ```
  An AST engine considers this safe because `auth()` was called. An **AI engine** understands that anyone can pass any `id` and read any other tenant's document!

#### The AI Prompt & Diff Strategy
To minimize cost and latency while eliminating hallucinations:
1. **Scope Down to Diffs**: Never feed the whole repository to the LLM. Feed the **Git Unified Diff** of the commit, filtered to modified files (`.ts`, `.tsx`, `.js`, `.py`).
2. **Context Window**: For every modified file, extract only added lines (`+`) plus 10 surrounding context lines.
3. **Strict JSON Schema (Structured Output)**:

```typescript
export interface AISecurityFinding {
  vulnerabilityType: "BOLA_IDOR" | "BROKEN_AUTH" | "PRIVILEGE_ESCALATION" | "SENSITIVE_DATA_LEAK";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  filePath: string;
  line: number;
  explanation: string;
  remediationSnippet: string;
}
```

---

### 2.4. The Delta Risk Meter (Scoring Algorithm)

Vibecoders do not read long compliance PDFs. They care about **immediate, visible feedback on what changed**.

#### Mathematical Formula

Every project starts with a **Baseline Security Score**: $S = 100$

Each finding applies a severity penalty:
* **Critical** ($W_c$): $-25$ points (e.g., Unauthenticated mutation route, leaked master secret)
* **High** ($W_h$): $-15$ points (e.g., BOLA/IDOR on read queries, missing CSRF)
* **Medium** ($W_m$): $-5$ points (e.g., Overly permissive CORS, verbose error exposure)
* **Low** ($W_l$): $-2$ points (e.g., Deprecated package version, missing rate limit)

$$\text{Commit Score} = \max\left(0, 100 - \sum (W_i \times N_i)\right)$$

$$\Delta \text{ Risk} = \text{Score}_{\text{new\_commit}} - \text{Score}_{\text{previous\_commit}}$$

#### User Experience Representation:
* If $\Delta < 0$: **Security Regression Alert**
  > *"⚠️ Commit `c0ffee` dropped security from **95% ➔ 70%** ($\Delta -25\%$). Added `/api/billing` with no authentication."*
* If $\Delta > 0$: **Security Recovery Celebration**
  > *"🎉 Commit `a1b2c3` improved security to **95%** ($\Delta +25\%$). Resolved unauthenticated route."*

---

## 3. Database Schema Design (`packages/database`)

PostgreSQL is the single source of truth for repository history, commits, and findings.

```sql
-- Tracked Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    current_security_score INT DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Commits Inspected
CREATE TABLE commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    author VARCHAR(255),
    message TEXT,
    security_score INT NOT NULL,
    delta_score INT NOT NULL,
    pushed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, commit_sha)
);

-- Individual Security Findings
CREATE TABLE security_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_id UUID REFERENCES commits(id) ON DELETE CASCADE,
    engine VARCHAR(30) NOT NULL, -- 'DETERMINISTIC_AST' | 'AI_SEMANTIC'
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    file_path TEXT NOT NULL,
    line_number INT,
    title VARCHAR(255) NOT NULL,
    explanation TEXT NOT NULL,
    suggested_patch TEXT,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_commits_project ON commits(project_id);
CREATE INDEX idx_findings_commit ON security_findings(commit_id);
```

---

## 4. Educational Guide: What You Need to Know

### 4.1. Understanding AMQP Message Acknowledgment & Dead-Lettering
In RabbitMQ, messages must be acknowledged so the broker knows they were safely processed:
* `channel.ack(msg)`: Processing completed successfully. Message is safely removed from the queue.
* `channel.reject(msg, false)`: Processing permanently failed. Because `requeue = false`, RabbitMQ routes the message to the Dead Letter Exchange (`thirdeye.dlx`).
* **Why this matters**: If an LLM call times out or an invalid JSON payload arrives, the worker does NOT crash or loop endlessly; the toxic message is safely quarantined.

### 4.2. Understanding Unified Diffs
A Git diff is structured in chunks (hunks):
```diff
@@ -14,6 +14,8 @@ export async function POST(req: Request) {
-  const result = await db.user.delete({ where: { id } });
+  const session = await auth();
+  if (!session) return new Response("Unauthorized", { status: 401 });
+  const result = await db.user.delete({ where: { id, userId: session.user.id } });
```
* `@@ -14,6 +14,8 @@`: Old file started at line 14 (6 lines), new file starts at line 14 (8 lines).
* `-`: Lines removed.
* `+`: Lines added.
* Lines with no prefix: Context lines.

Your analysis engine focuses predominantly on lines starting with `+` to analyze new risks introduced by the commit.

### 4.3. Understanding BOLA/IDOR (OWASP API #1)
Broken Object Level Authorization occurs when an application exposes an endpoint that takes an object identifier (e.g. `/api/invoices/1234`) and fails to check if the requesting user actually owns invoice `1234`. Vibecoders constantly fall into this trap because AI models generate clean queries that omit user-ownership checks.

---

## 5. Phased Implementation Roadmap

| Phase | Objective | Deliverables |
| :--- | :--- | :--- |
| **Phase 1: Worker Core** | Setup RabbitMQ consumer in `apps/worker` | `queueManager.createConsumer` listening to `deployments_queue`, graceful shutdown. |
| **Phase 2: Git Diff Fetcher** | Obtain commit diffs | Fetching commit comparisons using GitHub API with commit SHA pairs. |
| **Phase 3: Deterministic AST** | Build first two AST rules in `@thirdeye/analysis` | 1. Unauthenticated Route Gate<br>2. Client Secret/Env Exposure Scanner. |
| **Phase 4: Persistence & Delta Meter** | Database records & score logic | PostgreSQL schema migration, score calculation, commit snapshotting. |
| **Phase 5: AI Semantic Engine** | Contextual LLM analysis | Prompt construction, structured JSON outputs for BOLA/IDOR detection. |
| **Phase 6: Dashboard & Actionable Fixes** | Present findings to the user | Next.js visual timeline showing Delta Risk dips and copy-pasteable patches. |

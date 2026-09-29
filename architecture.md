# ThirdEye (DevPulse) — Architecture & System Design

## 1. Executive Summary & Vision

**ThirdEye** (DevPulse) is a developer-centric **observability, deployment tracking, and incident correlation platform**. 

### The Problem
When modern web applications fail or experience sudden error spikes in production, the root cause is almost always a **recent code deployment or configuration release**. Traditional Application Performance Monitoring (APM) tools (e.g., Datadog, New Relic) are often overly complex, expensive, and separated from developer workflows. Error loggers (e.g., Sentry) log exceptions, but lack native, first-class context on who deployed what and when.

### The Solution
ThirdEye bridges the gap between **code deployments and application health**:
- **Answers the critical question**: *"Did our latest deployment cause these errors?"*
- **Correlates**: GitHub commits & PRs ↔ Vercel deployments ↔ Real-time application errors & HTTP 500s.
- **Highlights the root cause**: Surfaces a unified, chronological timeline pinpointing the exact deployment, commit SHA, and author responsible for an incident.

---

## 2. High-Level Architecture Diagram

```
                 ┌─────────────────────────────────┐
                 │         GitHub / Vercel         │
                 │        Webhooks & APIs          │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │       ThirdEye API Server       │
                 │       (Node.js / Express)       │
                 └────────────────┬────────────────┘
                                  │
                           Validate Webhook
                           Enqueue Payload
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │       Message Queue Layer       │
                 │        (BullMQ + Redis)         │
                 └────────────────┬────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌──────────────┐        ┌──────────────┐       ┌───────────────┐
   │  Deployment  │        │    Error     │       │  Correlation  │
   │    Worker    │        │    Worker    │       │    Worker     │
   └──────┬───────┘        └──────┬───────┘       └───────┬───────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                                  ▼
                 ┌─────────────────────────────────┐
                 │        PostgreSQL Database      │
                 │   Events / Errors / Deployments │
                 └────────────────┬────────────────┘
                                  │
                         ┌────────▼────────┐
                         │   Redis Cache   │
                         │   & Pub/Sub     │
                         └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │    Dashboard    │
                         │ (Next.js/React) │
                         └─────────────────┘
```

---

## 3. Subsystem Breakdown

### 3.1. Integrations Layer
- **V1 (Zero-SDK Approach)**:
  - **GitHub**: Captures repositories, branch pushes, commits, and pull requests via Webhooks & GitHub REST/GraphQL APIs.
  - **Vercel**: Captures deployment states (`BUILDING`, `READY`, `ERROR`, `CANCELED`), commit SHAs, deployment URLs, and environments (Preview vs. Production).
  - **Webhook Endpoints**: Receives real-time events securely with HMAC signature verification.
- **Future Enhancements**:
  - Native ThirdEye SDK for direct runtime instrumentation.
  - Log collectors & Docker/Kubernetes container sidecars.
  - Additional cloud providers (AWS, GCP, Netlify, Render, Railway).

---

### 3.2. API Server (Ingestion & Core Management)
- **Tech Stack**: Node.js, TypeScript.
- **Responsibilities**:
  - Authentication & Organization/Project management.
  - OAuth handshakes (GitHub App / Vercel Integration).
  - Secure webhook ingestion endpoints.
  - Event payload validation and rate-limiting.
- **Design Principle (Fast Ingestion)**:
  The API server strictly acts as a high-throughput, non-blocking gatekeeper. It must **not** perform heavy data processing synchronously.
  ```
  Incoming Webhook ──► Validate Signature ──► Enqueue Job ──► HTTP 200 OK (Fast Ack)
  ```

---

### 3.3. Asynchronous Queue Layer
- **Tech Stack**: BullMQ backed by Redis (or RabbitMQ).
- **Purpose**: Decouples webhook ingress from analytical processing, providing backpressure handling, retry mechanisms, and concurrency control.
- **Standard Job Types**:
  - `deployment.received`: Raw deployment event from Vercel/CI.
  - `github.commit.received`: Commit and PR metadata from GitHub.
  - `error.received`: Ingestion of an error or exception log.
  - `analyze.deployment`: Trigger post-deployment health checks.
  - `correlate.error`: Run incident detection algorithms.
  - `send.notification`: Dispatch alert messages.

---

### 3.4. Background Worker Fleet
Independent worker processes consume queue tasks and execute specific domain logic:

1. **Deployment Worker**:
   - Parses deployment payloads and extracts deployment URLs, environments, commit SHAs, and statuses.
   - Upserts deployment records in PostgreSQL.
2. **Error Worker**:
   - Ingests incoming errors and normalizes stack traces.
   - Groups duplicate errors using fingerprinting algorithms (e.g., hash of route + error type + top stack frame).
   - Updates error frequency counters.
3. **Correlation Worker (Core Intelligence)**:
   - Detects correlations between new deployments and sudden error spikes.
   - Evaluates:
     - **Timeframe**: Errors starting within $X$ minutes of a deployment finish.
     - **Scope**: Matching route, microservice, or environment.
     - **Anomaly**: Error rate exceeding historical baseline.
   - Automatically generates an **Incident** record tied to the specific deployment and commit.
4. **Notification Worker**:
   - Dispatches actionable alerts containing deployment context, suspect commit, and culprit route.
   - Channels: Email, Discord, Slack, and in-app webhooks.

---

### 3.5. Persistence Layer (PostgreSQL)
PostgreSQL acts as the single source of truth for all relational entities:
- `users`: User profiles and authentication details.
- `projects`: Monitored applications and environments.
- `integrations`: OAuth tokens and webhook secrets (GitHub, Vercel).
- `repositories`: Linked Git repositories and branches.
- `commits`: Commit hash, author, commit message, timestamp.
- `deployments`: Deployment ID, provider, status, target branch/commit, deployed URL.
- `errors`: Fingerprinted error occurrences, messages, stack traces, and metadata.
- `events`: Raw and processed lifecycle events.
- `incidents`: Detected anomalies, severity level, affected routes, and linked deployment.
- `notifications`: Delivery logs and alert preferences.

---

### 3.6. Ephemeral & In-Memory Layer (Redis)
Redis is leveraged exclusively for transient, high-speed workloads:
- **Queue Engine**: BullMQ job state, concurrency control, and delayed retry scheduling.
- **Dashboard Cache**: Caching heavy aggregation queries (e.g., 24h error graphs).
- **Webhook Deduplication**: Short-lived keys to reject duplicate webhook deliveries (`Idempotency-Key` or event ID).
- **Rate Limiting**: Sliding window counters protecting ingestion endpoints.
- **Pub/Sub**: Real-time event broadcasting to push live updates to the frontend dashboard.

---

### 3.7. Frontend Dashboard
- **Tech Stack**: Next.js (App Router), React, TailwindCSS.
- **Key Views**:
  - **Project Overview**: High-level health score, active deployment status, and error counts.
  - **Deployments**: History of all Vercel/CI builds, commit authors, and status tags.
  - **Errors**: Grouped error list with stack traces, frequency counts, and first/last seen timestamps.
  - **Incidents**: Active and resolved incidents with correlation summaries.
  - **Unified Timeline (Signature Feature)**: Real-time chronological feed linking deployments directly to error spikes:
    ```
    14:32  🚀 Deployment #182 (main - "fix: checkout cart")
    14:35  ⚠️ Error rate increased (+450%)
    14:36  🔥 /checkout → 500 Internal Server Error
    14:37  🔍 42 similar errors grouped (TypeError: Cannot read properties of undefined)
    14:38  🚨 Incident #42 triggered: High probability linked to Deployment #182
    ```

---

## 4. End-to-End V1 Event Flow

```
User connects GitHub & Vercel
           │
           ▼
Developer pushes code & triggers Vercel deployment
           │
           ▼
Vercel dispatches `deployment.succeeded` webhook
           │
           ▼
ThirdEye API validates signature & pushes job to BullMQ
           │
           ▼
Deployment Worker saves deployment to PostgreSQL & warms Redis cache
           │
           ▼
Runtime errors occur on newly deployed service
           │
           ▼
Error Worker groups errors & notices anomaly
           │
           ▼
Correlation Worker matches error window with Deployment #182
           │
           ▼
Incident generated in PostgreSQL & broadcasted via Redis Pub/Sub
           │
           ▼
Dashboard updates in real-time & Notification Worker alerts the team
```

---

## 5. Phased Implementation Roadmap

| Phase | Milestone | Focus Areas |
| :--- | :--- | :--- |
| **Phase 1** | **Auth & Projects** | Multi-tenant auth, organization/project management, API key issuance. |
| **Phase 2** | **GitHub Integration** | GitHub App / OAuth, repo selection, commit & PR sync. |
| **Phase 3** | **Vercel Integration** | Vercel OAuth, deployment webhook setup, project mapping. |
| **Phase 4** | **Webhook Ingestion** | High-throughput signature verification, idempotency, raw payload logging. |
| **Phase 5** | **Queue & Workers** | BullMQ setup on Redis, worker isolation, retry strategies. |
| **Phase 6** | **Deployment Timeline** | Next.js timeline UI rendering deployments with Git commit context. |
| **Phase 7** | **Error Ingestion & Grouping** | Ingestion endpoint, stack trace parsing, error fingerprinting. |
| **Phase 8** | **Correlation Engine** | Time-window algorithms linking error rate spikes to deployment events. |
| **Phase 9** | **Alerts & Notifications** | Discord/Slack webhooks, email alerts, and in-app incident resolution. |

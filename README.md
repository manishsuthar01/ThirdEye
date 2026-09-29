# 👁️ ThirdEye (DevPulse)

> **Deployment Observability & Incident Correlation Platform**  
> Answer the critical question: *"Did our latest deployment cause these errors?"*

---

## 📖 Overview

**ThirdEye** is a developer-centric platform designed to bridge the gap between **code deployments** and **production application health**. 

Modern applications rarely break in a vacuum—production incidents are overwhelmingly triggered by recent code pushes, migrations, or configuration releases. ThirdEye monitors your deployments from GitHub and Vercel, ingests application errors, and automatically correlates error spikes to the exact commit, author, and deployment that caused them.

---

## ✨ Key Features

- **🔗 Zero-SDK Integrations**: Connects seamlessly with GitHub (commits, PRs) and Vercel (deployments, environments) via real-time webhooks.
- **⚡ Fast-Ingestion Architecture**: Webhook endpoints validate and enqueue events in milliseconds, preventing webhook timeouts.
- **🧠 Intelligent Correlation Engine**: Analyzes time windows, routes, and error spikes to tie production incidents to suspect deployments.
- **⏱️ Unified Event Timeline**: A chronological real-time stream showing deployments, error surges, and incident triggers side-by-side.
- **📦 Deduplication & Fingerprinting**: Normalizes stack traces and groups high-frequency duplicate errors automatically.
- **🔔 Actionable Alerts**: Dispatches rich incident notifications with the offending commit SHA, author, and route.

---

## 🏗️ Architecture at a Glance

```
GitHub / Vercel Webhooks
           │
           ▼
    ThirdEye API (Node.js)  ──► Fast Validate & 200 OK
           │
           ▼
  Message Queue (BullMQ + Redis)
     │            │            │
     ▼            ▼            ▼
[Deployment]   [Error]   [Correlation]
   Worker      Worker        Worker
     │            │            │
     └────────────┬────────────┘
                  ▼
         PostgreSQL (Source of Truth)
                  │
             Redis (Cache & Pub/Sub)
                  │
                  ▼
       Next.js / React Dashboard
```

> 📘 **Full Architecture & System Design**: Read the comprehensive architecture documentation in [architecture.md](architecture.md).

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | [Next.js](https://nextjs.org) (App Router), [React](https://react.dev), [TailwindCSS](https://tailwindcss.com) |
| **API & Ingestion** | Node.js, TypeScript |
| **Queue & Workers** | [BullMQ](https://bullmq.io), [Redis](https://redis.io) |
| **Database** | [PostgreSQL](https://www.postgresql.org) |
| **Cache & Pub/Sub** | [Redis](https://redis.io) |

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed locally:
- **Node.js** (v20+ recommended)
- **npm**, **pnpm**, or **yarn**
- **Docker** (optional, for running local PostgreSQL & Redis containers)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/manishsuthar01/ThirdEye.git
cd ThirdEye
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/thirdeye

# Redis & Queue
REDIS_URL=redis://localhost:6379

# GitHub & Vercel Webhook Secrets
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret
VERCEL_WEBHOOK_SECRET=your_vercel_webhook_secret
```

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

---

## 🗺️ Implementation Roadmap

- [x] **Phase 1**: Project initialization & System Architecture ([architecture.md](architecture.md))
- [ ] **Phase 2**: Authentication & Project Management
- [ ] **Phase 3**: GitHub Integration (Commits & PR sync)
- [ ] **Phase 4**: Vercel Integration (Deployment events)
- [ ] **Phase 5**: Webhook Ingestion & BullMQ Queue pipeline
- [ ] **Phase 6**: Specialized Background Worker Fleet
- [ ] **Phase 7**: Unified Deployment & Error Timeline UI
- [ ] **Phase 8**: Automated Deployment ↔ Error Correlation Engine
- [ ] **Phase 9**: Incident Alerts (Discord, Slack, Email)

---

## 📄 License

This project is licensed under the MIT License.

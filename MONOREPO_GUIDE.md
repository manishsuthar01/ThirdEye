# ThirdEye Monorepo Architecture & Trade-Offs Guide

This document serves as an architectural deep-dive into the decision to use a **Monorepo** for **ThirdEye**, exploring the "Why?", the trade-offs, and the key interview questions associated with monorepos vs. polyrepos using clear diagrams and real-world scenarios.

---

## Table of Contents
1. [What is a Monorepo? (The Mental Model)](#1-what-is-a-monorepo-the-mental-model)
2. [Why Monorepo? (The Benefits & Real-World Story)](#2-why-monorepo-the-benefits--real-world-story)
3. [The Trade-Offs & Challenges (The "Gotchas")](#3-the-trade-offs--challenges-the-gotchas)
4. [Visualizing Monorepo vs. Polyrepo Workflows](#4-visualizing-monorepo-vs-polyrepo-workflows)
5. [Common Interview Questions & Interactive Explanations](#5-common-interview-questions--interactive-explanations)

---

### 1. What is a Monorepo? (The Mental Model)

Imagine running a restaurant kitchen. 
* **The Polyrepo approach** is having three separate buildings: one building for baking bread, one for making sauces, and one for cooking meat. If the sauce recipe changes, you have to pack it in a box, ship it across town, and hope the meat and bread buildings update their menus at the exact same time.
* **The Monorepo approach** is a large, open-plan kitchen where the bread baker, sauce maker, and grill chef share the same counter. If the sauce becomes spicier, the grill chef sees it immediately and adjusts the meat seasoning on the spot.

In software terms:
```text
=================================================================
                      THIRDEYE MONOREPO LAYOUT
=================================================================
  [ ThirdEye Root Folder ]
  ├── apps/
  │   ├── web/        (Next.js Dashboard)
  │   ├── api/        (Express REST API)
  │   └── worker/     (RabbitMQ Commit Processor)
  └── packages/
      ├── database/   (Prisma / PostgreSQL client)
      ├── queue/      (RabbitMQ connection & DLQ setup)
      ├── analysis/   (Commit diff parser engine)
      └── types/      (Shared TypeScript Interfaces)
=================================================================
```

---

### 2. Why Monorepo? (The Benefits & Real-World Story)

#### The Breaking Change Scenario (Without Monorepo - Polyrepo)
Suppose you change a field name in your database model from `commitId` to `sha` in your shared library.
1. You commit and publish `shared-lib@1.0.0` to npm.
2. You go to the `api` repository, update `package.json` to `1.0.1`, fix the code, and deploy.
3. You forget to update the `worker` repository. 
4. **Boom!** The worker crashes in production because it's still looking for `commitId`.

#### The Monorepo Advantage (Atomic Commits)
In ThirdEye's monorepo:
1. You change `commitId` $\rightarrow$ `sha` in `packages/types`.
2. You update `apps/api` and `apps/worker` in the **exact same git commit**.
3. TypeScript compiler (`tsc`) instantly flags any missed files across the entire project before you even push to GitHub.

---

### 3. The Trade-Offs & Challenges (The "Gotchas")

Every architecture has a dark side. An interviewer *will* test you on these:

*   **Build Times (The Bloat Trap):** If you touch a CSS file in `apps/web`, a poorly configured CI pipeline will rebuild the entire API, worker, and database packages. 
    * *Solution:* Smart build caching tools like **Turborepo** or **Nx** that track file hashes and only build what actually changed.
*   **Security & Access Control:** In a polyrepo, you can give junior devs access to `apps/web` while locking down `apps/api`. In a monorepo, everyone has access to everything.
*   **Git History Bloat:** Cloning the repo pulls down history for every app and package, making initial checkouts heavy as the project scales to gigabytes.

---

### 4. Visualizing Monorepo vs. Polyrepo Workflows

```text
=================================================================
                   SCENARIO: CHANGING A SHARED TYPE
=================================================================

[ POLYREPO WORKFLOW: Multi-Step Nightmare ]
  Step 1: Edit shared package ──> Publish to Registry (npm)
                                         │
  Step 2: Update API repo ───────────────┼──> Wait for CI
                                         │
  Step 3: Update Worker repo ────────────┘──> Version mismatch risk!


[ MONOREPO WORKFLOW: Atomic Safety ]
  Single Git Commit:
    ├── Edit `packages/types/src/index.ts`   (Rename field)
    ├── Edit `apps/api/src/server.ts`        (Adopt new field)
    └── Edit `apps/worker/src/worker.ts`     (Adopt new field)
          │
          ▼
  [ TypeScript Compiler / CI Validation ] ──> All apps pass or fail together!
=================================================================
```

---

### 5. Common Interview Questions & Interactive Explanations

#### Q1: "Why did you choose a Monorepo for ThirdEye instead of separate repos?"

> **Interactive Answer / Talking Track:**
> *"I chose a monorepo because ThirdEye is a tightly coupled distributed system where apps share domain logic. If my worker consumes messages produced by my API, they must agree on the exact data schema (`packages/types`). 
> 
> In a polyrepo, changing a data contract requires versioning, publishing, and coordinating deployments across multiple repositories, which introduces race conditions and breaking changes. With a monorepo, I get **atomic commits**—I can refactor a type, update the API producer, and update the worker consumer in one PR, with the TypeScript compiler instantly verifying correctness."*

---

#### Q2: "What are the scaling bottlenecks of a Monorepo, and how do engineering teams at companies like Meta or Google solve them?"

> **Interactive Answer / Talking Track:**
> *"The biggest bottlenecks are **CI build times** and **unnecessary test runs**. As a repo grows to thousands of packages, running tests for everything on every PR becomes bottlenecked.
> 
> Tech giants and modern monorepos solve this with **Task Orchestrators (like Turborepo or Nx)** and **Distributed Caching**. 
> 
> ```text
> [ Developer Push ] ──> [ Turborepo Hash Check ] 
>                              │
>          ┌───────────────────┴───────────────────┐
>     (Code unchanged)                      (Code changed)
>          ▼                                       ▼
>   [ RESTORE FROM CACHE ]                 [ RUN BUILD / TESTS ]
>   (Takes 0.2 seconds)                     (Takes 5 minutes)
> ```
> 
> These tools create a dependency graph. If a PR only touches the frontend dashboard, Turborepo looks at the dependency graph, realizes the backend API and database packages are unaffected, and skips building them entirely, saving massive CI costs."*

---

#### Q3: "How does dependency management work under the hood in a Monorepo without version conflicts?"

> **Interactive Answer / Talking Track:**
> *"Modern package managers like **pnpm** use **Symlinks** and a **Content-Addressable Store**. 
> 
> In a traditional npm setup (`node_modules`), you get deeply nested folders and potential version mismatches where App A uses React 18 and App B uses React 17. 
> 
> Pnpm solves this by creating a global store on your disk. Every package in the monorepo is symlinked to that single store. Internal packages (like `packages/queue` used by `apps/worker`) reference each other via workspace protocols (`workspace:*`), meaning changes inside `packages/queue` are reflected instantly in the worker without running `npm install` again."*

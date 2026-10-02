# ThirdEye — Understanding the Monorepo From the Ground Up

---

## 1. The Complete Current Folder Tree

This is **exactly** what exists in your repository right now (excluding `node_modules/` and `.git/` which are auto-generated):

```
thirdeye/
│
├── apps/
│   ├── web/                              ← Next.js dashboard
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   └── .gitkeep
│   │   ├── hooks/
│   │   │   └── .gitkeep
│   │   ├── lib/
│   │   │   └── .gitkeep
│   │   ├── eslint.config.mjs
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   ├── postcss.config.mjs
│   │   └── tsconfig.json
│   │
│   ├── api/                              ← Backend API server
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   ├── lib/
│   │   │   │   └── index.ts
│   │   │   ├── middleware/
│   │   │   │   └── index.ts
│   │   │   ├── modules/
│   │   │   │   ├── github/
│   │   │   │   │   └── index.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── index.ts
│   │   │   │   ├── webhooks/
│   │   │   │   │   └── index.ts
│   │   │   │   └── commits/
│   │   │   │       └── index.ts
│   │   │   └── server.ts                 ← API entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── worker/                           ← Background job processor
│       ├── src/
│       │   ├── jobs/
│       │   │   └── index.ts
│       │   ├── processors/
│       │   │   └── index.ts
│       │   ├── services/
│       │   │   └── index.ts
│       │   └── worker.ts                 ← Worker entry point
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── database/                         ← DB schema, migrations, queries
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── queue/                            ← Redis/BullMQ queue definitions
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── analysis/                         ← Code analysis engine
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── types/                            ← Shared TypeScript interfaces
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── docker/
│   │   └── .gitkeep
│   └── scripts/
│       └── .gitkeep
│
├── docs/
│   └── README.md
│
├── .env.example                          ← Environment variable template
├── .gitignore                            ← Git exclusions
├── docker-compose.yml                    ← Local Postgres + Redis
├── package.json                          ← Root workspace config
├── pnpm-workspace.yaml                   ← Monorepo definition
├── tsconfig.base.json                    ← Shared TypeScript settings
├── AGENTS.md
├── CLAUDE.md
├── README.md
└── architecture.md
```

> [!NOTE]
> The `.gitkeep` files are empty placeholders. Git cannot track empty directories, so we put a tiny file inside to make sure folders like `components/` and `hooks/` are preserved in Git even though they have no real code yet.

---

## 2. What is the Root `thirdeye/` Folder?

The root folder is the **container for the entire project**. It is not an application itself — it doesn't run any code. Instead, it does two things:

1. **Declares that this is a monorepo** (via `pnpm-workspace.yaml`)
2. **Holds shared configuration** that applies to everything inside (TypeScript settings, environment variables, Docker services)

Think of it like the **main office building**. The building itself doesn't do the work. The teams inside do. But the building provides electricity, internet, and shared meeting rooms that all teams use.

---

## 3. The `apps/` Folder — Your Running Applications

### Why do we have an `apps/` folder?

In a monorepo, you often have **multiple programs** that run independently. The `apps/` folder groups all of them together. Each subfolder inside `apps/` is a **complete, runnable program** with its own `package.json`, its own dependencies, and its own start command.

Right now, we have three:

---

### `apps/web/` — The Next.js Dashboard

**What it is:** A Next.js web application that displays the dashboard users interact with in their browser.

**What it does:**
- Shows a login page
- Displays a list of connected GitHub repositories
- Shows commit analysis results
- Lets users browse code reviews

**What it contains right now:**

| File/Folder | Purpose |
|---|---|
| `app/layout.tsx` | The root HTML layout (wraps every page) |
| `app/page.tsx` | The home page (`/`) |
| `app/globals.css` | Global CSS styles |
| `components/` | Will hold reusable UI pieces (buttons, cards, tables) |
| `hooks/` | Will hold custom React hooks |
| `lib/` | Will hold utility functions (e.g., an API client to talk to the API) |
| `package.json` | Lists the web app's own dependencies (React, Next.js, Tailwind) |
| `next.config.ts` | Next.js configuration |
| `tsconfig.json` | TypeScript configuration for this app |

**How to run it:** `pnpm dev:web` (starts on `http://localhost:3000`)

---

### `apps/api/` — The Backend API Server

**What it is:** A Node.js HTTP server that handles all the backend logic.

**What it does:**
- Receives webhook events from GitHub ("hey, a new commit was pushed!")
- Provides REST API endpoints for the web dashboard to fetch data
- Creates background jobs when new commits need to be analyzed

**What it contains right now:**

| File/Folder | Purpose |
|---|---|
| `src/server.ts` | The entry point — starts the HTTP server |
| `src/config/index.ts` | Reads environment variables (port, database URL, GitHub secrets) |
| `src/middleware/index.ts` | Will hold auth checks, request logging, error handling |
| `src/lib/index.ts` | Will hold helper functions shared across API modules |
| `src/modules/github/` | Will handle GitHub App installation and authentication |
| `src/modules/repositories/` | Will handle CRUD for tracked repos |
| `src/modules/webhooks/` | Will receive and validate GitHub webhook events |
| `src/modules/commits/` | Will create records for new commits and dispatch analysis jobs |

**How to run it:** `pnpm dev:api` (starts on `http://localhost:4000`)

**Why modules instead of one big folder?** Instead of dumping all routes, services, and logic into a single `routes/` folder, we organize by *domain*. Everything related to "webhooks" lives in `modules/webhooks/`. Everything related to "repositories" lives in `modules/repositories/`. This is called **modular architecture** — as the app grows, each module stays manageable.

---

### `apps/worker/` — The Background Job Processor

**What it is:** A Node.js process (no HTTP server) that runs in the background and processes jobs from a queue.

**What it does:**
- Listens to a Redis queue for new jobs ("analyze commit abc123")
- Fetches the commit diff from GitHub
- Runs code analysis (static analysis, AI review)
- Saves the results to the database

**What it contains right now:**

| File/Folder | Purpose |
|---|---|
| `src/worker.ts` | The entry point — connects to Redis and starts consuming jobs |
| `src/jobs/` | Will define what types of jobs exist and how to process them |
| `src/processors/` | Will contain the step-by-step analysis pipeline |
| `src/services/` | Will contain service classes (GitHub API client, analysis orchestrator) |

**How to run it:** `pnpm dev:worker`

---

### 🍕 Real-World Analogy: A Pizza Restaurant

Think of ThirdEye like a pizza restaurant:

| ThirdEye App | Pizza Restaurant Equivalent |
|---|---|
| **`web`** | The **restaurant website** where customers browse the menu and place orders |
| **`api`** | The **front counter / order system** that receives orders, validates them, and passes them to the kitchen |
| **`worker`** | The **kitchen** where the actual cooking (analysis) happens in the background |

The customer (GitHub) doesn't walk into the kitchen. They interact with the counter (API). The counter writes the order on a ticket (queue job) and puts it on the kitchen rail. The kitchen picks it up and starts cooking. When the food is ready, it goes to the display (database), and the customer can see it on the website (web).

---

## 4. The `packages/` Folder — Shared Code Libraries

### Why are these separate from `apps/`?

Apps are **runnable programs**. Packages are **reusable code libraries** that apps import.

Here's the problem packages solve: The API needs to talk to the database. The worker also needs to talk to the database. Without a shared package, you'd have to **write the same database code twice** — once inside `apps/api/` and once inside `apps/worker/`. If you change the database schema, you'd have to update it in two places. That's fragile and error-prone.

Instead, we put the database code in `packages/database/`, and both apps import it:

```typescript
// Inside apps/api/src/server.ts (someday)
import { db } from "@thirdeye/database";

// Inside apps/worker/src/worker.ts (someday)
import { db } from "@thirdeye/database";
```

Both apps get the **exact same code**. Change it once, both apps get the update.

### What "shared package" means in simple terms

A shared package is a folder of code with its own `package.json` that **doesn't run on its own** — it only does something when another app imports it. Think of it like a toolbox. The toolbox doesn't build anything by itself, but the carpenter (app) uses tools from it.

---

### `packages/database/`

**What problem it solves:** Provides a single source of truth for how ThirdEye talks to PostgreSQL.

**What it will contain:**
- Database schema definitions (what tables exist, what columns they have)
- Migration files (instructions to create/modify tables over time)
- A database client (the connection to PostgreSQL)
- Query functions (`getCommitById()`, `saveAnalysisResult()`, etc.)

**Who uses it:** The API (to read/write data), the worker (to save analysis results), potentially the web app (for server-side data fetching).

**Runs code?** Not by itself — it exports functions that other apps call.

---

### `packages/queue/`

**What problem it solves:** Defines the "contract" between the API (which creates jobs) and the worker (which processes them).

**What it will contain:**
- Redis connection setup
- Queue name constants (e.g., `"commit-analysis"`)
- Job payload schemas (what data a job carries — e.g., `{ commitId: "abc123", repoId: 42 }`)
- Enqueue helper functions (`enqueueCommitAnalysis(commitId)`)

**Who uses it:** The API (producer — adds jobs to the queue) and the worker (consumer — takes jobs off the queue).

**Runs code?** No — it's a shared library. The API and worker import from it.

**Why does this need to be shared?** If the API pushes a job with `{ commitId: "abc" }` but the worker expects `{ commit_id: "abc" }`, things break silently. By sharing one definition, both sides agree on the shape of the data.

---

### `packages/analysis/`

**What problem it solves:** Contains the actual code analysis logic — the core "brain" of ThirdEye.

**What it will contain:**
- Diff parser (turns a raw Git diff into structured data)
- Static analysis integrations
- AI-based code review (calling an LLM to review code changes)
- Result normalization (turning raw analysis output into a consistent format)

**Who uses it:** Primarily the worker. Could also be used by the API if we ever want to do lightweight analysis inline.

**Runs code?** No — it's a library of functions. The worker calls them.

---

### `packages/types/`

**What problem it solves:** Holds TypeScript interfaces and types that multiple apps need.

**Example:** If both the API and the web app need to understand what a "Commit" looks like:

```typescript
// packages/types/src/index.ts
export interface Commit {
  id: string;
  sha: string;
  message: string;
  repositoryId: number;
  analysisStatus: "pending" | "processing" | "completed" | "failed";
}
```

Now both `apps/api/` and `apps/web/` can import this interface and stay in sync.

**Who uses it:** Any app or package that needs shared type definitions.

**Runs code?** No — types are erased at runtime. This package only exists at compile-time for TypeScript.

---

## 5. Root Configuration Files

### `pnpm-workspace.yaml` — The Monorepo Declaration

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**What it does:** Tells pnpm "this is a monorepo, and here's where to find all the projects inside it." Without this file, pnpm would treat the root as a single project and ignore the `apps/` and `packages/` folders.

**What problem it solves:** Enables the monorepo. This is the single most important configuration file in the repo.

**Who uses it:** pnpm (the package manager). You never import or reference this file in code.

**Runs code?** No — pure configuration.

---

### `package.json` (root) — Workspace Scripts and Metadata

```json
{
  "name": "thirdeye",
  "scripts": {
    "dev:web": "pnpm --filter @thirdeye/web dev",
    "dev:api": "pnpm --filter @thirdeye/api dev",
    "dev:worker": "pnpm --filter @thirdeye/worker dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint"
  }
}
```

**What it does:** Provides convenience scripts so you can run commands from the root instead of `cd`-ing into each app. `pnpm dev:web` is a shortcut for "go into `apps/web/` and run its `dev` script."

**What problem it solves:** Without this, you'd have to open 3 separate terminals and `cd` into each app to start them. Now you can run everything from the root.

**The `--filter` flag:** `pnpm --filter @thirdeye/web dev` means "find the package named `@thirdeye/web` and run its `dev` script." The `@thirdeye/` prefix is just a namespace — like a last name for your packages to avoid name collisions with public npm packages.

**The `-r` flag:** `pnpm -r build` means "run the `build` script in every package, recursively." It goes through all 7 projects (3 apps + 4 packages) and builds each one.

---

### `tsconfig.base.json` — Shared TypeScript Settings

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "moduleResolution": "bundler",
    ...
  }
}
```

**What it does:** Defines TypeScript compiler settings that all apps and packages inherit.

**What problem it solves:** Without this, you'd copy-paste the same 15 lines of TypeScript config into every `tsconfig.json`. Instead, each app says:

```json
// apps/api/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

"Use everything from the base, but also add these app-specific settings."

> [!NOTE]
> The `apps/web/tsconfig.json` does **not** extend `tsconfig.base.json`. That's because Next.js has its own strict requirements for TypeScript settings (like `jsx: "react-jsx"`, `moduleResolution: "bundler"`, and special Next.js plugins). So the web app manages its own complete tsconfig.

---

### `.env.example` — Environment Variable Template

**What it does:** Documents every environment variable the project needs, with safe placeholder values.

**What problem it solves:** When a new developer clones the repo, they copy this file to `.env` and fill in their actual values. Without it, they'd have to guess what variables exist.

**Runs code?** No — it's a template. The actual `.env` file (which is git-ignored) is what apps read at runtime.

---

### `.gitignore` — Git Exclusions

**What it does:** Tells Git which files/folders to never track.

**Key exclusions:**
- `node_modules/` — installed dependencies (huge, regenerated by `pnpm install`)
- `dist/` — compiled output (regenerated by `pnpm build`)
- `.next/` — Next.js build cache
- `.env` — secrets (should never be in Git)

---

### `docker-compose.yml` — Local Development Services

```yaml
services:
  postgres:   # PostgreSQL database on port 5432
  redis:      # Redis on port 6379
```

**What it does:** Spins up PostgreSQL and Redis as Docker containers on your machine.

**What problem it solves:** Instead of installing PostgreSQL and Redis directly on your computer (which is messy and version-dependent), you run `docker compose up -d` and get both services instantly. `docker compose down` removes them cleanly.

**Who uses it:** You, the developer, during local development. In production, these would be managed services (like AWS RDS, ElastiCache, etc.).

---

### `docs/` — Documentation Folder

**What it does:** Will hold architecture decisions, API documentation, and development guides.

**Runs code?** No — plain markdown files for humans to read.

---

### `infra/` — Infrastructure and Deployment

| Subfolder | Purpose |
|---|---|
| `docker/` | Will hold Dockerfiles for building production images of each app |
| `scripts/` | Will hold maintenance scripts (seed database, reset data, etc.) |

**Runs code?** The scripts will, when you execute them manually. Dockerfiles are build instructions, not runtime code.

---

## 6. How the Three Apps Communicate

Here's the complete data flow through ThirdEye:

```
  ┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
  │  GitHub   │────────▶│   API    │────────▶│  Queue   │────────▶│  Worker  │────────▶│ Database │
  │  (event)  │  HTTP   │ apps/api │  Redis  │ (BullMQ) │  Redis  │apps/worker│ SQL     │(Postgres)│
  └──────────┘         └──────────┘         └──────────┘         └──────────┘         └──────────┘
                                                                                            │
                                                                                            │ SQL
                                                                                            ▼
                                                                                      ┌──────────┐
                                                                                      │   Web    │
                                                                                      │ apps/web │
                                                                                      └──────────┘
```

### Step by step:

**Step 1: GitHub sends a webhook to the API**
> A developer pushes code to a repository that has the ThirdEye GitHub App installed. GitHub automatically sends an HTTP POST request to our API: *"Hey, here's a new push event with commits X, Y, Z."*

**Step 2: The API validates and creates a job**
> The API's `modules/webhooks/` receives this request, verifies the signature (is this really from GitHub?), and extracts the commit information. It saves a preliminary commit record to the database (status: "pending"), then uses `packages/queue/` to push a job onto the Redis queue: *"Analyze commit abc123."*
> 
> **Crucially, the API does NOT analyze the code itself.** Webhook requests have a timeout. If the API tried to do code analysis (which can take 30+ seconds), GitHub would time out and retry, causing duplicate work. So the API just says "got it, I'll handle it later" and returns immediately.

**Step 3: The Worker picks up the job**
> The worker is constantly watching the Redis queue. When it sees a new job, it:
> 1. Fetches the commit diff from GitHub using the GitHub API
> 2. Passes the diff to `packages/analysis/` for code review
> 3. Saves the analysis results to the database using `packages/database/`
> 4. Updates the commit status to "completed"

**Step 4: The Web dashboard reads from the database**
> When a user opens the ThirdEye dashboard, the web app fetches data (either directly from the database via server components, or by calling the API). It displays the commit list, analysis results, and code review feedback.

### What connects them:

| Connection | Technology | Which Package Manages It |
|---|---|---|
| API ↔ Database | PostgreSQL (TCP) | `packages/database/` |
| API → Queue | Redis (TCP) | `packages/queue/` |
| Queue → Worker | Redis (TCP) | `packages/queue/` |
| Worker ↔ Database | PostgreSQL (TCP) | `packages/database/` |
| Web ↔ Database | PostgreSQL (TCP) | `packages/database/` |
| Web → API | HTTP (REST) | `apps/web/lib/` (API client) |

> [!IMPORTANT]
> The three apps **never import code from each other**. `apps/api/` never does `import something from "../../apps/worker/"`. They communicate only through external systems: the database and the queue. This is what makes them truly independent — you can restart the worker without affecting the API, or deploy a new version of the web app without touching the worker.

---

## 7. Every Folder and File — Purpose, User, and Nature

### Root Files

| File | What Problem It Solves | Who Uses It | Config or Code? |
|---|---|---|---|
| `pnpm-workspace.yaml` | Declares the monorepo structure | pnpm | Config |
| `package.json` | Root scripts and metadata | Developers (via terminal) | Config |
| `tsconfig.base.json` | Shared TypeScript settings | All apps/packages (at compile time) | Config |
| `.env.example` | Documents required env vars | New developers | Config (template) |
| `.gitignore` | Prevents junk from entering Git | Git | Config |
| `docker-compose.yml` | Runs Postgres and Redis locally | Developers (via Docker) | Config |
| `README.md` | Project overview | Humans | Documentation |
| `architecture.md` | Architecture decisions | Humans | Documentation |

### `apps/web/`

| File/Folder | What Problem It Solves | Who Uses It | Config or Code? |
|---|---|---|---|
| `app/layout.tsx` | HTML shell for every page | Next.js (at runtime) | Code |
| `app/page.tsx` | Home page content | Next.js (at runtime) | Code |
| `app/globals.css` | Base styles | Browser (at runtime) | Code |
| `components/` | Reusable UI elements | Other components/pages | Code (future) |
| `hooks/` | Custom React hooks | Components | Code (future) |
| `lib/` | API clients, utilities | Components/pages | Code (future) |
| `package.json` | Web app dependencies | pnpm | Config |
| `tsconfig.json` | Web TypeScript settings | TypeScript compiler | Config |
| `next.config.ts` | Next.js behavior | Next.js | Config |
| `postcss.config.mjs` | CSS processing (Tailwind) | PostCSS/build system | Config |
| `eslint.config.mjs` | Linting rules | ESLint | Config |

### `apps/api/`

| File/Folder | What Problem It Solves | Who Uses It | Config or Code? |
|---|---|---|---|
| `src/server.ts` | Starts the HTTP server | Node.js (at runtime) | Code |
| `src/config/` | Centralizes env var reading | All API modules | Code |
| `src/middleware/` | Auth, logging, error handling | HTTP request pipeline | Code (future) |
| `src/lib/` | Shared API helpers | API modules | Code (future) |
| `src/modules/github/` | GitHub App integration | Webhook + repo features | Code (future) |
| `src/modules/repositories/` | Repo CRUD endpoints | Web dashboard (via HTTP) | Code (future) |
| `src/modules/webhooks/` | Receives GitHub events | GitHub (via HTTP) | Code (future) |
| `src/modules/commits/` | Commit tracking + job dispatch | Webhooks module + queue | Code (future) |

### `apps/worker/`

| File/Folder | What Problem It Solves | Who Uses It | Config or Code? |
|---|---|---|---|
| `src/worker.ts` | Connects to Redis, starts consuming | Node.js (at runtime) | Code |
| `src/jobs/` | Maps queue names to handler functions | Worker framework (BullMQ) | Code (future) |
| `src/processors/` | Step-by-step analysis pipeline | Job handlers | Code (future) |
| `src/services/` | GitHub API client, analysis orchestrator | Processors | Code (future) |

### `packages/`

| Package | What Problem It Solves | Who Uses It | Config or Code? |
|---|---|---|---|
| `database/` | Single source of truth for DB access | API, Worker, Web | Code (library) |
| `queue/` | Shared job contracts and queue setup | API (producer), Worker (consumer) | Code (library) |
| `analysis/` | Code review logic | Worker (primarily) | Code (library) |
| `types/` | Shared TypeScript interfaces | All apps and packages | Code (types only) |

---

## 8. Application vs. Package vs. Library vs. Module

These terms can be confusing because people use them loosely. Here's what each means **in the context of ThirdEye**:

### Application (things in `apps/`)

An application is a **program that runs on its own**. It has a start command. It does something when you launch it.

- `apps/web/` → runs `next dev` → starts a web server on port 3000
- `apps/api/` → runs `tsx src/server.ts` → starts an HTTP server on port 4000
- `apps/worker/` → runs `tsx src/worker.ts` → starts a background process

**Key trait:** You can `cd` into it and run it. It has an entry point.

### Package (things in `packages/`)

A package is a **folder of code with its own `package.json`** that is meant to be imported by other packages or apps. It doesn't do anything by itself.

- `packages/database/` — you can't "run" it. But you can `import { db } from "@thirdeye/database"` inside an app.

**Key trait:** It exists to be imported, not to be started.

### Library

"Library" and "package" mean essentially the same thing in this project. `packages/database/` is a library. `packages/analysis/` is a library. The term "library" emphasizes that it's a collection of reusable functions.

### Module (things in `apps/api/src/modules/`)

A module is a **sub-section within an app**, organized by domain/feature. Unlike packages, modules are NOT shared across apps. They exist only to keep one app's code organized.

- `modules/webhooks/` is a module within the API. It doesn't have its own `package.json`. It's just a folder.
- `modules/github/` is another module within the API.

**Key trait:** Internal organization within a single app. No `package.json`, not shared.

### Summary Table

| Term | Has its own `package.json`? | Runs on its own? | Shared across apps? | Example |
|---|---|---|---|---|
| **Application** | ✅ | ✅ | ❌ | `apps/api/` |
| **Package** | ✅ | ❌ | ✅ | `packages/database/` |
| **Library** | ✅ | ❌ | ✅ | Same as package |
| **Module** | ❌ | ❌ | ❌ | `apps/api/src/modules/webhooks/` |

---

## 9. Mental Model — Remember This

```
┌──────────────────────────────────────────────────────────────────┐
│                        thirdeye/ (the building)                  │
│                                                                  │
│   ┌─── apps/ ─────────────────────────────────────────────┐     │
│   │  Three independent programs that run separately:       │     │
│   │                                                        │     │
│   │  🌐 web    = the website users see                     │     │
│   │  📡 api    = the backend that receives events          │     │
│   │  ⚙️  worker = the engine that does the heavy work      │     │
│   └────────────────────────────────────────────────────────┘     │
│                          │ import from                           │
│                          ▼                                       │
│   ┌─── packages/ ─────────────────────────────────────────┐     │
│   │  Shared toolboxes that apps reach into:                │     │
│   │                                                        │     │
│   │  🗄️  database = how to talk to PostgreSQL              │     │
│   │  📬 queue    = how to pass jobs between API & worker   │     │
│   │  🔬 analysis = the code review brain                   │     │
│   │  📝 types    = shared vocabulary (TypeScript types)    │     │
│   └────────────────────────────────────────────────────────┘     │
│                                                                  │
│   📄 Root config files = shared settings for the building        │
└──────────────────────────────────────────────────────────────────┘
```

**The one sentence to remember:**

> **Apps are programs that run. Packages are toolboxes that apps share. Apps talk to each other through the database and the queue — never by importing each other's code.**

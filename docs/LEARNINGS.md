# Engineering Learnings & Curated Architectural Reading List

A curated collection of engineering papers, foundational specifications, and real-world system designs directly relevant to building ThirdEye's zero-trust AppSec and observability platform.

---

## 1. Sandboxing Untrusted Code & Ephemeral Isolation

Running untrusted customer or pull request code directly on host infrastructure is an anti-pattern. These resources explain how production platforms enforce multi-tenant isolation:

* **[Fly.io: Sandboxing Untrusted Code](https://fly.io/blog/sandboxing-untrusted-code/)**  
  *Why read it*: The gold standard explanation of why multi-tenant container sharing is dangerous, how Linux namespaces & cgroups actually isolate processes, and why ephemeral disposable sandboxes are necessary.
* **[AWS Firecracker: Lightweight Virtualization for Serverless Applications (USENIX ATC)](https://www.usenix.org/conference/atc20/presentation/agache)**  
  *Why read it*: Explains how AWS Lambda and Fargate run untrusted customer code in single-use microVMs with sub-second boot times.
* **[Google gVisor Architecture & Threat Model](https://gvisor.dev/docs/architecture_guide/)**  
  *Why read it*: A deep dive into intercepting Linux system calls (`syscalls`) to prevent malicious code from reaching the host kernel.

---

## 2. Hermetic & Zero-Network Builds

Decoupling source acquisition from static analysis allows running tools in completely offline environments:

* **[SLSA (Supply chain Levels for Software Artifacts) — Hermeticity](https://slsa.dev/spec/v1.0/principles#hermetic)**  
  *Why read it*: Explains the concept of Hermetic Execution—why isolating build/scan steps from the internet ensures reproducible, deterministic results and blocks exfiltration attacks.
* **[Docker Documentation: Resource Constraints and Seccomp Profiles](https://docs.docker.com/engine/security/seccomp/)**  
  *Why read it*: Learn what `--cap-drop ALL`, `no-new-privileges`, and seccomp syscall filtering actually do to contain a compromised process.

---

## 3. Static Analysis Internals & Standard Formats

How security engines analyze source code without compiling whole applications:

* **[OASIS SARIF Specification (Static Analysis Results Interchange Format)](https://sarifweb.azurewebsites.net/)**  
  *Why read it*: SARIF is the universal JSON schema used by OpenGrep, CodeQL, and GitHub Checks. Understanding runs, rules, and physical locations makes building ThirdEye's normalizer trivial.
* **[Scaling Static Analysis at Semgrep (Semgrep Blog)](https://semgrep.dev/blog/)**  
  *Why read it*: Explains how tree-sitter parses code into ASTs and how structural matching algorithms run 100x faster than traditional compilation.

---

## 4. Git Internals & Content-Addressed Storage

Why Git commits and trees are immutable snapshots that make perfect cache keys:

* **[Pro Git Book: Chapter 10 — Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain-Commands)**  
  *Why read it*: Explains how Git stores snapshots as immutable SHA-addressed trees and blobs. Essential for understanding why commit SHAs make perfect cache keys.

---

## 5. Architectural Principles Implemented in ThirdEye

1. **Compartmentalized Execution Pattern**:
   - `source-fetcher`: Has network egress + short-lived read token, but zero scanner execution logic.
   - `scanner-runner`: Has zero network egress (`--network none`) + zero credentials, running untrusted static analysis safely.
2. **Deterministic Offline Scanning**:
   - Vulnerability databases (Trivy DB) and OpenGrep rule packs are baked into pinned container images rather than fetched at runtime.
3. **Resilient Fingerprinting**:
   - Code findings are fingerprinted via `SHA256(ruleId + path + snippet)` so that line shifts caused by surrounding code changes do not create false-positive alerts.
4. **Security Delta Calculation**:
   - Every PR is evaluated as a delta: $\text{Findings}(\text{Head}) - \text{Findings}(\text{Base}) \implies \{\text{new}, \text{resolved}, \text{persistent}\}$.


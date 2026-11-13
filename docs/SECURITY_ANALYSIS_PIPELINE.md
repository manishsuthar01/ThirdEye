# ThirdEye Security Analysis Pipeline Specification

## 1. Architectural Principles

1. **Air-Gapped Scanner Execution**: Security scanners (SAST, SCA, Secret scanning) execute untrusted code parsers inside an air-gapped container (`--network none`) running as an unprivileged user (`UID 10001:10001`) with dropped Linux capabilities (`--cap-drop ALL`).
2. **Ephemeral Isolation**: Each analysis run operates on an isolated temporary workspace on the host disk with automated retry backoff during teardown to avoid lingering file handles.
3. **Differential Delta Analysis**: Analysis produces two finding sets: `baseFindings` (target branch) and `headFindings` (pull request branch). The engine indexes findings by stable SHA-256 fingerprints to separate net-new regressions from persistent technical debt.

---

## 2. Two-Stage Execution Model

```text
Worker Job Event
       │
       ▼
[Stage 1: Source Fetcher]  (thirdeye-source-fetcher:latest)
       │  • Network: bridge
       │  • DNS: 8.8.8.8, 1.1.1.1
       │  • Downloads base & head git archives via GitHub tarball endpoint
       │  • Streams through GNU tar into /workspace/base and /workspace/head
       │
       ▼
[Stage 2: Scanner Runner]  (thirdeye-scanner-runner:latest)
       │  • Network: none (strictly air-gapped)
       │  • User: 10001:10001
       │  • Memory: 2GB, CPUs: 2.0, PIDs limit: 512
       │  • OpenGrep (SAST): Evaluates offline rules (/rules/security.yaml)
       │  • Trivy (SCA & Secrets): Evaluates preloaded vulnerability database
       │  • Writes normalized results to /out/results.json
       │
       ▼
[Stage 3: Security Delta Engine]  (@thirdeye/analysis)
       │  • Fingerprint Index: SHA-256(ruleId + filePath + snippet)
       │  • Classifies: New, Resolved, Persistent, Worsened
       │  • Evaluates Deployment Gate: BLOCK, WARN, or PASS
       │
       ▼
[Stage 4: Feedback Loop]  (@thirdeye/worker)
          • Sets Commit Status on GitHub (failure / success)
          • Posts executive Markdown dashboard comment on PR discussion tab
```

---

## 3. Fingerprinting & Normalization

To prevent line-shift drift (e.g. adding a comment above a vulnerability shifts its line number), findings are hashed using their structural characteristics:

$$\text{fingerprint} = \text{SHA-256}(\text{ruleId} + \text{normalizedRelativePath} + \text{sanitizedSnippet})$$

### Canonical Finding Model

```typescript
export interface SecurityFinding {
    fingerprint: string;                  // Stable SHA-256 hash
    ruleId: string;                       // e.g. "javascript.lang.security.audit.detect-eval"
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
    evidence: string[];                   // Redacted code context (no raw secrets)
    remediation?: string;
}
```

---

## 4. Delta Engine Classification Logic

For each finding in `headFindings`:
- If `fingerprint` does **not** exist in `baseFindings` $\to$ **`new` (Regression)**.
- If `fingerprint` exists in `baseFindings`:
  - If `headSeverity > baseSeverity` $\to$ **`worsened`**.
  - Else $\to$ **`persistent` (Pre-existing Technical Debt)**.

Any findings in `baseFindings` not present in `headFindings` $\to$ **`resolved` (Fixed)**.

---

## 5. Deployment Gate Decision Matrix

| Verdict | Trigger Conditions | Action |
|---|---|---|
| **`BLOCK`** | Any `critical` or `high` regression (`new` or `worsened`). | Sets Commit Status to `failure`, blocks merge. |
| **`WARN`** | Any `medium` regression, or Risk Score $\ge 4$. | Sets Commit Status with warning description. |
| **`PASS`** | Zero regressions (or only `low`/`info` findings with score $< 4$). | Sets Commit Status to `success`. |

$$\text{Risk Score} = (N_{\text{critical}} \times 10) + (N_{\text{high}} \times 5) + (N_{\text{medium}} \times 2) + (N_{\text{low}} \times 1) - (N_{\text{resolved}} \times 2)$$

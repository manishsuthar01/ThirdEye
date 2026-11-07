/**
 * @thirdeye/types
 *
 * Shared domain models, contracts, and canonical schemas.
 */

// --- 1. Webhook & Ingress Contracts ---

export type WebhookProvider = "github" | "vercel";

export interface WebhookMetadata {
    // Pull Request Specific
    action?: string;
    prNumber?: number;
    title?: string;
    author?: string;
    baseSha?: string;
    baseRef?: string;
    headSha?: string;
    headRef?: string;
    cloneUrl?: string;
    installationId?: number;

    // Push Specific
    ref?: string;
    head?: string;
    before?: string;
    pusher?: string;
    compareUrl?: string;

    [key: string]: any;
}

export interface NormalizedWebhookEvent {
    provider: WebhookProvider;
    eventType: string;
    projectId: string;
    projectName: string;
    projectSlug: string;
    commitSha: string;
    metadata: WebhookMetadata;
    triggerId: string;
    triggerType: string;
    timestamp: Date | string;
}

// --- 2. Security Finding & Analysis Contracts ---

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingCategory = "sast" | "dependency" | "secret";
export type FindingSource = "opengrep" | "trivy" | "thirdeye_auth";

export interface FindingLocation {
    file: string;
    startLine?: number;
    endLine?: number;
}

export interface SecurityFinding {
    fingerprint: string;                  // Stable SHA-256 hash resilient to line shifts
    ruleId: string;
    source: FindingSource;
    category: FindingCategory;
    severity: FindingSeverity;
    title: string;
    description: string;
    location: FindingLocation;
    evidence: string[];                   // Redacted code context (no raw secrets)
    remediation?: string;
}

export interface SecurityDelta {
    new: SecurityFinding[];               // Regressions introduced in Head
    resolved: SecurityFinding[];          // Pre-existing issues fixed in Head
    persistent: SecurityFinding[];        // Unchanged technical debt
    worsened: SecurityFinding[];          // Increased severity or scope
}

// --- 3. Sandbox Runner Contracts ---

export interface ScanJob {
    jobId: string;
    repository: {
        id: string;
        slug: string;                      // "owner/repo"
        cloneUrl: string;
    };
    revisions: {
        baseSha: string;
        headSha: string;
        prNumber?: number;
    };
    timeoutMs: number;
}

export interface ScannerMetadata {
    opengrepVersion?: string;
    trivyDbVersion?: string;
    scannedAt: string;
}

export interface ScanResult {
    jobId: string;
    status: "SUCCESS" | "FAILED";
    scannerMetadata: ScannerMetadata;
    baseFindings: SecurityFinding[];
    headFindings: SecurityFinding[];
    errors?: string[];
}

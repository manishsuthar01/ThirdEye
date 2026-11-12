import type { FindingSeverity, SecurityDelta, SecurityFinding } from "@thirdeye/types";

const SEVERITY_RANK: Record<FindingSeverity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

/**
 * Compares security findings between the base branch and the head revision.
 *
 * Categorizes findings into:
 * - new: Introduced in this revision (regressions)
 * - resolved: Present in base, but absent in head (fixed)
 * - persistent: Present in both, severity unchanged (technical debt)
 * - worsened: Present in both, but severity escalated
 *
 * Performance: O(N + M) single-pass lookup using stable SHA-256 fingerprints.
 */
export function calculateSecurityDelta(
    baseFindings: SecurityFinding[],
    headFindings: SecurityFinding[]
): SecurityDelta {
    const baseMap = new Map<string, SecurityFinding>();
    for (const finding of baseFindings) {
        baseMap.set(finding.fingerprint, finding);
    }

    const delta: SecurityDelta = {
        new: [],
        resolved: [],
        persistent: [],
        worsened: [],
    };

    for (const headFinding of headFindings) {
        const baseFinding = baseMap.get(headFinding.fingerprint);

        if (!baseFinding) {
            // Fingerprint does not exist in base -> net-new regression
            delta.new.push(headFinding);
        } else {
            // Exists in both revisions -> check if severity worsened
            const baseRank = SEVERITY_RANK[baseFinding.severity] ?? 0;
            const headRank = SEVERITY_RANK[headFinding.severity] ?? 0;

            if (headRank > baseRank) {
                delta.worsened.push(headFinding);
            } else {
                delta.persistent.push(headFinding);
            }

            // Remove from baseMap so only unconsumed (resolved) findings remain
            baseMap.delete(headFinding.fingerprint);
        }
    }

    // Any remaining items in baseMap were resolved in this PR
    for (const resolvedFinding of baseMap.values()) {
        delta.resolved.push(resolvedFinding);
    }

    return delta;
}


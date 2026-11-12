import type { FindingSeverity, SecurityDelta } from "@thirdeye/types";

export interface GateDecision {
    verdict: "PASS" | "WARN" | "BLOCK";
    score: number;
    reasons: string[];
}

const SEVERITY_WEIGHTS: Record<FindingSeverity, number> = {
    critical: 10,
    high: 5,
    medium: 2,
    low: 1,
    info: 0,
};

/**
 * Evaluates the SecurityDelta against automated deployment gating rules.
 *
 * Decision Rules:
 * - BLOCK: Any new or worsened CRITICAL or HIGH severity finding.
 * - WARN: Any new MEDIUM severity finding, or risk score >= 4.
 * - PASS: No new regressions, or only LOW/INFO findings with score < 4.
 */
export function evaluateDeploymentGate(delta: SecurityDelta): GateDecision {
    const reasons: string[] = [];
    let score = 0;

    // 1. Calculate risk score for net-new findings (regressions)
    for (const finding of delta.new) {
        const weight = SEVERITY_WEIGHTS[finding.severity] ?? 0;
        score += weight;

        if (finding.severity === "critical" || finding.severity === "high") {
            reasons.push(
                `Introduced new ${finding.severity.toUpperCase()} finding: "${finding.title}" (${finding.ruleId})`
            );
        }
    }

    // 2. Add score for worsened findings
    for (const finding of delta.worsened) {
        score += SEVERITY_WEIGHTS[finding.severity] ?? 0;
        reasons.push(
            `Escalated severity to ${finding.severity.toUpperCase()}: "${finding.title}" (${finding.ruleId})`
        );
    }

    // 3. Offset score for resolved issues (incentivize bug fixing)
    for (const finding of delta.resolved) {
        const credit = Math.min(SEVERITY_WEIGHTS[finding.severity] ?? 0, 2);
        score = Math.max(0, score - credit);
    }

    // 4. Compute deployment verdict
    const hasCriticalOrHighRegression =
        delta.new.some((f) => f.severity === "critical" || f.severity === "high") ||
        delta.worsened.some((f) => f.severity === "critical" || f.severity === "high");

    let verdict: "PASS" | "WARN" | "BLOCK" = "PASS";

    if (hasCriticalOrHighRegression) {
        verdict = "BLOCK";
    } else if (delta.new.some((f) => f.severity === "medium") || score >= 4) {
        verdict = "WARN";
        if (reasons.length === 0) {
            reasons.push(`Medium risk threshold reached with score of ${score}`);
        }
    }

    return {
        verdict,
        score,
        reasons,
    };
}

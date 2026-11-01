import type { SecurityFinding } from "../types";

/**
 * Calculates a normalized Delta Risk Score (0 - 100) based on severity weights.
 */
export function calculateRiskScore(findings: SecurityFinding[]): number {
    // TODO: Weight findings by severity (CRITICAL, HIGH, MEDIUM, LOW)
    return 0;
}


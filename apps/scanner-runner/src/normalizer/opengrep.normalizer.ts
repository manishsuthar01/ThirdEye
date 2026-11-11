import type { FindingSeverity, SecurityFinding } from "@thirdeye/types";
import { generateFingerprint } from "./fingerprint";

export function mapOpenGrepSeverity(severity: string): FindingSeverity {
    switch (severity?.toUpperCase()) {
        case "ERROR":
            return "high";
        case "WARNING":
            return "medium";
        case "INFO":
            return "low";
        default:
            return "medium";
    }
}

/**
 * Normalizes OpenGrep raw JSON output into canonical SecurityFinding[]
 */
export function normalizeOpenGrepFindings(rawJson: any, targetPrefix: string = ""): SecurityFinding[] {
    if (!rawJson || !Array.isArray(rawJson.results)) {
        return [];
    }

    const findings: SecurityFinding[] = [];

    for (const result of rawJson.results) {
        const ruleId = result.check_id || "opengrep.unknown_rule";
        const rawPath = result.path || "";
        const relativePath = rawPath.replace(new RegExp(`^${targetPrefix}/?`), "");
        const lines = result.extra?.lines || "";
        const severity = mapOpenGrepSeverity(result.extra?.severity);

        const fingerprint = generateFingerprint(ruleId, relativePath, lines);

        findings.push({
            fingerprint,
            ruleId,
            source: "opengrep",
            category: "sast",
            severity,
            title: result.extra?.message?.split("\n")[0] || ruleId,
            description: result.extra?.message || "",
            location: {
                file: relativePath,
                startLine: result.start?.line,
                endLine: result.end?.line,
            },
            evidence: lines ? [lines.trim()] : [],
            remediation: result.extra?.fix || undefined,
        });
    }

    return findings;
}


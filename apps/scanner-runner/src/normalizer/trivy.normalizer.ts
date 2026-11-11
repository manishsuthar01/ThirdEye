import type { FindingSeverity, SecurityFinding } from "@thirdeye/types";
import { generateFingerprint } from "./fingerprint";

export function mapTrivySeverity(severity: string): FindingSeverity {
    switch (severity?.toUpperCase()) {
        case "CRITICAL":
            return "critical";
        case "HIGH":
            return "high";
        case "MEDIUM":
            return "medium";
        case "LOW":
            return "low";
        default:
            return "info";
    }
}

/**
 * Redacts secrets so raw tokens/passwords are NEVER stored or persisted.
 */
export function redactSecret(secret: string): string {
    if (!secret || secret.length < 8) {
        return "***REDACTED***";
    }
    const prefix = secret.slice(0, 4);
    const suffix = secret.slice(-2);
    return `${prefix}***REDACTED***${suffix}`;
}

/**
 * Normalizes Trivy raw JSON output (Vulnerabilities and Secrets) into canonical SecurityFinding[]
 */
export function normalizeTrivyFindings(rawJson: any, targetPrefix: string = ""): SecurityFinding[] {
    if (!rawJson || !Array.isArray(rawJson.Results)) {
        return [];
    }

    const findings: SecurityFinding[] = [];

    for (const target of rawJson.Results) {
        const rawTarget = target.Target || "";
        const relativePath = rawTarget.replace(new RegExp(`^${targetPrefix}/?`), "");

        // 1. Dependency Vulnerabilities (SCA)
        if (Array.isArray(target.Vulnerabilities)) {
            for (const vuln of target.Vulnerabilities) {
                const ruleId = vuln.VulnerabilityID || "trivy.cve";
                const pkgInfo = `${vuln.PkgName || "pkg"}@${vuln.InstalledVersion || "unknown"}`;
                const fingerprint = generateFingerprint(ruleId, relativePath, pkgInfo);

                findings.push({
                    fingerprint,
                    ruleId,
                    source: "trivy",
                    category: "dependency",
                    severity: mapTrivySeverity(vuln.Severity),
                    title: vuln.Title || `${ruleId} in ${pkgInfo}`,
                    description: vuln.Description || `Vulnerability in ${pkgInfo}`,
                    location: {
                        file: relativePath,
                    },
                    evidence: [
                        `Package: ${pkgInfo}`,
                        vuln.FixedVersion ? `Fixed in: ${vuln.FixedVersion}` : "No fixed version available",
                    ],
                    remediation: vuln.FixedVersion ? `Upgrade ${vuln.PkgName} to version ${vuln.FixedVersion}` : undefined,
                });
            }
        }

        // 2. Secret & Credential Detection
        if (Array.isArray(target.Secrets)) {
            for (const secret of target.Secrets) {
                const ruleId = secret.RuleID || "trivy.secret";
                const redactedMatch = redactSecret(secret.Match || "");
                const fingerprint = generateFingerprint(ruleId, relativePath, redactedMatch);

                findings.push({
                    fingerprint,
                    ruleId,
                    source: "trivy",
                    category: "secret",
                    severity: mapTrivySeverity(secret.Severity || "CRITICAL"),
                    title: secret.Title || `Exposed Secret (${secret.Category || ruleId})`,
                    description: `Potential secret or credential leak detected in ${relativePath}`,
                    location: {
                        file: relativePath,
                        startLine: secret.StartLine,
                        endLine: secret.EndLine,
                    },
                    evidence: [redactedMatch],
                    remediation: "Revoke and rotate this secret immediately and remove it from git history.",
                });
            }
        }
    }

    return findings;
}


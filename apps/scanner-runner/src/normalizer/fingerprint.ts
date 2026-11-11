import { createHash } from "node:crypto";

/**
 * Generates a stable, resilient SHA-256 fingerprint for a finding.
 *
 * Why:
 * Line numbers shift when unrelated lines are added or removed above a finding.
 * By hashing the ruleId, the normalized relative path, and a sanitized snippet/sink,
 * the fingerprint remains constant even when lines drift.
 */
export function generateFingerprint(
    ruleId: string,
    filePath: string,
    evidenceSnippet: string = ""
): string {
    // Normalize path separators to forward slashes and strip input prefixes
    const normalizedPath = filePath
        .replace(/\\/g, "/")
        .replace(/^(\/input\/)?(base|head)\//, "");

    // Sanitize snippet by trimming whitespace to tolerate minor formatting changes
    const sanitizedSnippet = evidenceSnippet.trim().replace(/\s+/g, " ");

    const hash = createHash("sha256");
    hash.update(`${ruleId}:${normalizedPath}:${sanitizedSnippet}`);
    return hash.digest("hex");
}


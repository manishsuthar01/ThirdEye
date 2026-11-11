import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecurityFinding } from "@thirdeye/types";
import { normalizeTrivyFindings } from "../normalizer/trivy.normalizer";

const execFileAsync = promisify(execFile);

export async function runTrivy(
    targetDir: string
): Promise<{ findings: SecurityFinding[]; error?: string }> {
    const args = [
        "fs",
        "--format", "json",
        "--skip-db-update",
        "--offline-scan",
        "--scanners", "vuln,secret",
        targetDir,
    ];

    try {
        console.log(`[Trivy] Scanning target: ${targetDir}...`);
        const { stdout } = await execFileAsync("trivy", args, {
            maxBuffer: 50 * 1024 * 1024,
            timeout: 120_000,
        });

        const rawJson = JSON.parse(stdout);
        const findings = normalizeTrivyFindings(rawJson, targetDir);
        console.log(`[Trivy] Completed for ${targetDir}: ${findings.length} findings.`);
        return { findings };
    } catch (err: any) {
        // If Trivy outputs valid JSON in stdout despite non-zero exit code
        if (err.stdout) {
            try {
                const rawJson = JSON.parse(err.stdout);
                const findings = normalizeTrivyFindings(rawJson, targetDir);
                return { findings };
            } catch {
                // Not valid JSON
            }
        }

        console.warn(`[Trivy] Scanner execution failed or skipped: ${err.message}`);
        return {
            findings: [],
            error: `Trivy failed: ${err.message}`,
        };
    }
}


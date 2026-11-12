import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecurityFinding } from "@thirdeye/types";
import { normalizeOpenGrepFindings } from "../normalizer/opengrep.normalizer";

const execFileAsync = promisify(execFile);

export async function runOpenGrep(
    targetDir: string,
    rulesPath: string = "/rules"
): Promise<{ findings: SecurityFinding[]; error?: string }> {
    const args = [
        "scan",
        "--json",
        "--quiet",
        "--metrics=off",
        "--disable-version-check",
        "--config", rulesPath,
        targetDir,
    ];

    try {
        console.log(`[OpenGrep] Scanning target: ${targetDir}...`);
        const { stdout } = await execFileAsync("opengrep", args, {
            maxBuffer: 50 * 1024 * 1024, // 50MB output buffer limit
            timeout: 120_000,
        });

        const rawJson = JSON.parse(stdout);
        const findings = normalizeOpenGrepFindings(rawJson, targetDir);
        console.log(`[OpenGrep] Completed for ${targetDir}: ${findings.length} findings.`);
        return { findings };
    } catch (err: any) {
        // OpenGrep exits with code 1 if findings are found, or code 0 if none
        if (err.stdout) {
            try {
                const rawJson = JSON.parse(err.stdout);
                const findings = normalizeOpenGrepFindings(rawJson, targetDir);
                return { findings };
            } catch {
                // Stdout was not valid JSON
            }
        }

        console.warn(`[OpenGrep] Scanner execution failed or skipped: ${err.message}`);
        return {
            findings: [],
            error: `OpenGrep failed: ${err.message}`,
        };
    }
}


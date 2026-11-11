/**
 * Scanner Runner Entry Point
 *
 * Environment: Strictly offline (--network none), read-only rootfs, non-root user.
 *
 * Responsibilities:
 * 1. Read input snapshots from /input/base and /input/head.
 * 2. Execute OpenGrep (SAST) on both snapshots using offline rules.
 * 3. Execute Trivy (SCA & Secrets) on both snapshots using preloaded DB.
 * 4. Normalize SARIF/JSON results into canonical SecurityFinding[].
 * 5. Write the final ScanResult JSON to /out/results.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ScanResult, SecurityFinding } from "@thirdeye/types";
import { runOpenGrep } from "./scanners/opengrep.scanner";
import { runTrivy } from "./scanners/trivy.scanner";

async function main(): Promise<void> {
    console.log("[ScannerRunner] Starting offline security analysis...");

    const inputDir = process.env.INPUT_DIR || "/input";
    const outDir = process.env.OUT_DIR || "/out";
    const jobId = process.env.JOB_ID || "unknown-job";

    const baseDir = path.join(inputDir, "base");
    const headDir = path.join(inputDir, "head");

    // Verify input directories exist
    try {
        await fs.access(baseDir);
        await fs.access(headDir);
    } catch {
        throw new Error(`[ScannerRunner] Input directories not found at ${baseDir} or ${headDir}`);
    }

    // Run scans concurrently across Base and Head revisions
    console.log("[ScannerRunner] Launching concurrent scanners across base and head snapshots...");
    const [baseOpenGrep, headOpenGrep, baseTrivy, headTrivy] = await Promise.all([
        runOpenGrep(baseDir),
        runOpenGrep(headDir),
        runTrivy(baseDir),
        runTrivy(headDir),
    ]);

    const baseFindings: SecurityFinding[] = [
        ...baseOpenGrep.findings,
        ...baseTrivy.findings,
    ];

    const headFindings: SecurityFinding[] = [
        ...headOpenGrep.findings,
        ...headTrivy.findings,
    ];

    const errors: string[] = [
        baseOpenGrep.error,
        headOpenGrep.error,
        baseTrivy.error,
        headTrivy.error,
    ].filter((e): e is string => typeof e === "string");

    const scanResult: ScanResult = {
        jobId,
        status: errors.length > 0 && headFindings.length === 0 && baseFindings.length === 0 ? "FAILED" : "SUCCESS",
        scannerMetadata: {
            opengrepVersion: "offline",
            trivyDbVersion: "preloaded",
            scannedAt: new Date().toISOString(),
        },
        baseFindings,
        headFindings,
        ...(errors.length > 0 ? { errors } : {}),
    };

    // Ensure output directory exists and write results.json
    await fs.mkdir(outDir, { recursive: true });
    const resultsPath = path.join(outDir, "results.json");
    await fs.writeFile(resultsPath, JSON.stringify(scanResult, null, 2), "utf8");

    console.log(`[ScannerRunner] Analysis complete. Base findings: ${baseFindings.length}, Head findings: ${headFindings.length}`);
    console.log(`[ScannerRunner] Results successfully written to ${resultsPath}`);
}

main().catch((err) => {
    console.error("[ScannerRunner] Fatal error:", err);
    process.exit(1);
});

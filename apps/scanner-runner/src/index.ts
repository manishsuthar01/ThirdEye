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

async function main(): Promise<void> {
    console.log("[ScannerRunner] Starting offline security analysis...");

    // TODO: Implement scanner execution, normalization, and output writing
}

main().catch((err) => {
    console.error("[ScannerRunner] Fatal error:", err);
    process.exit(1);
});


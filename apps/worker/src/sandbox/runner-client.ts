import type { ScanJob, ScanResult } from "@thirdeye/types";
import type { EphemeralWorkspace } from "./job-manager";
import { execFile } from "node:child_process"
import { promisify } from "node:util";
import path from "node:path";
import fs from 'node:fs/promises';

export interface SandboxRunnerClient {
    fetchSources(job: ScanJob, workspace: EphemeralWorkspace): Promise<void>;
    runScanners(job: ScanJob, workspace: EphemeralWorkspace): Promise<ScanResult>;
}

/**
 * Orchestrator client responsible for spawning disposable Docker containers
 * for Compartment 1 (Source Fetcher) and Compartment 2 (Scanner Runner).
 */
const execFileAsync = promisify(execFile);

export class DockerSandboxRunner implements SandboxRunnerClient {
    constructor(
        private fetcherImage: string = process.env.SOURCE_FETCHER_IMAGE || "thirdeye-source-fetcher:latest",
        private scannerImage: string = process.env.SCANNER_RUNNER_IMAGE || "thirdeye-scanner-runner:latest"
    ) { }

    private async runDocker(args: string[], timeoutMs: number = 120_000): Promise<{ stdout: string, stderr: string }> {
        try {
            return await execFileAsync('docker', args, { timeout: timeoutMs });
        } catch (err: any) {
            if (err.killed) {
                throw new Error(`[Docker] Process timed out after ${timeoutMs}ms: docker ${args.join(" ")}`);
            }
            throw new Error(`[Docker] Failed with exit code ${err.code}: ${err.stderr || err.message}`);
        }
    }

    async fetchSources(job: ScanJob, workspace: EphemeralWorkspace): Promise<void> {
        if (process.env.SANDBOX_MOCK_MODE === "true") {
            console.log(`[MockRunner] (Mock Mode) Simulating source acquisition for ${job.repository.slug}...`);
            await fs.writeFile(path.join(workspace.baseDir, "app.ts"), "// Base code snapshot\nconsole.log('base');\n");
            await fs.writeFile(path.join(workspace.headDir, "app.ts"), "// Head code snapshot (new route added)\nconsole.log('head');\n");
            console.log(`[MockRunner] (Mock Mode) Source snapshots written to base/ and head/`);
            return;
        }

        const args: string[] = [
            "run",
            "--rm",
            "--dns", "8.8.8.8",
            "--dns", "1.1.1.1",
            "-v", `${workspace.workspacePath}:/workspace`,
            "-e", `CLONE_URL=${job.repository.cloneUrl}`,
            "-e", `BASE_SHA=${job.revisions.baseSha || 'main'}`,
            "-e", `HEAD_SHA=${job.revisions.headSha}`,
            ...(process.env.GITHUB_TOKEN ? [
                '-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN}`] : []),
            this.fetcherImage,
        ];

        console.log(`[DockerRunner] Spawning Source Fetcher for ${job.repository.slug}...`);
        await this.runDocker(args, 120_000);
        console.log(`[DockerRunner] Source snapshots successfully prepared.`);
    }

    async runScanners(job: ScanJob, workspace: EphemeralWorkspace): Promise<ScanResult> {
        if (process.env.SANDBOX_MOCK_MODE === "true") {
            console.log(`[MockRunner] (Mock Mode) Simulating isolated scanner execution for ${job.jobId}...`);

            const mockResult: ScanResult = {
                jobId: job.jobId,
                status: "SUCCESS",
                scannerMetadata: {
                    opengrepVersion: "1.0.0-mock",
                    trivyDbVersion: "2026-11-09-mock",
                    scannedAt: new Date().toISOString(),
                },
                baseFindings: [],
                headFindings: [
                    {
                        fingerprint: "mock-hash-001",
                        ruleId: "mock.rule.missing_auth",
                        source: "opengrep",
                        category: "sast",
                        severity: "high",
                        title: "Mock: Route Missing Authentication Guard",
                        description: "Simulated vulnerability for pipeline verification.",
                        location: { file: "app.ts", startLine: 1, endLine: 2 },
                        evidence: ["// Head code snapshot (new route added)"],
                    },
                ],
            };

            // Write results.json into workspace outDir for full filesystem parity
            const resultsFilePath = path.join(workspace.outDir, "results.json");
            await fs.writeFile(resultsFilePath, JSON.stringify(mockResult, null, 2), "utf8");
            console.log(`[MockRunner] (Mock Mode) Results written to ${resultsFilePath}`);

            return mockResult;
        }

        const args = [
            "run",
            "--rm",
            // --- Network Isolation: absolute air-gap, zero exfiltration ---
            "--network", "none",
            // --- Resource Limits: prevent fork bombs and OOM ---
            "--memory", "2g",
            "--cpus", "2.0",
            "--pids-limit", "512",
            // --- Privilege Hardening: non-root, no capabilities, no escalation ---
            "--user", "10001:10001",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true",
            // --- Filesystem: source code is READ-ONLY, only /out is writable ---
            "-v", `${workspace.workspacePath}:/input:ro`,
            "-v", `${workspace.outDir}:/out`,
            // --- Pass job metadata ---
            "-e", `JOB_ID=${job.jobId}`,
            this.scannerImage,
        ];

        console.log(`[DockerRunner] Spawning Scanner Runner (--network none)...`);
        await this.runDocker(args, job.timeoutMs);

        const resultsFilePath = path.join(workspace.outDir, "results.json");

        try {
            const rawContent = await fs.readFile(resultsFilePath, 'utf8');
            const result: ScanResult = JSON.parse(rawContent);
            return result;
        } catch (error) {
            throw new Error(`[DockerRunner] Failed to parse results.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}


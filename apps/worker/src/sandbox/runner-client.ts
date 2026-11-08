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
        const args: string[] = [
            "run",
            "--rm",
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
        const args = [
            "run",
            "--rm",
            "--network", "none",
            "--memory", "1g",
            "--cpus", "1.0",
            "--pids-limit", "256",
            "--read-only",
            "--user", "10001:10001",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true",
            // Mount workspace input strictly READ-ONLY
            "-v", `${workspace.workspacePath}:/input:ro`,
            // Mount output directory writable
            "-v", `${workspace.outDir}:/out`,
            // In-memory temp scratchpads
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
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


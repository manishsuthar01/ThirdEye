import type { ScanJob, ScanResult } from "@thirdeye/types";
import type { EphemeralWorkspace } from "./job-manager";

export interface SandboxRunnerClient {
    fetchSources(job: ScanJob, workspace: EphemeralWorkspace): Promise<void>;
    runScanners(job: ScanJob, workspace: EphemeralWorkspace): Promise<ScanResult>;
}

/**
 * Orchestrator client responsible for spawning disposable Docker containers
 * for Compartment 1 (Source Fetcher) and Compartment 2 (Scanner Runner).
 */
export class DockerSandboxRunner implements SandboxRunnerClient {
    async fetchSources(job: ScanJob, workspace: EphemeralWorkspace): Promise<void> {
        // TODO: Spawn source-fetcher container with short-lived read token
        throw new Error("Not implemented yet");
    }

    async runScanners(job: ScanJob, workspace: EphemeralWorkspace): Promise<ScanResult> {
        // TODO: Spawn scanner-runner container with --network none, read-only rootfs, and hardened limits
        throw new Error("Not implemented yet");
    }
}


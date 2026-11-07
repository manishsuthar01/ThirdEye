import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ScanJob } from "@thirdeye/types";

export interface EphemeralWorkspace {
    workspacePath: string;
    baseDir: string;
    headDir: string;
    outDir: string;
    cleanup: () => Promise<void>;
}

/**
 * Manages the lifecycle of ephemeral host workspaces for scan jobs.
 * Enforces explicit directory creation and idempotent cleanup.
 */
export async function createJobWorkspace(job: ScanJob): Promise<EphemeralWorkspace> {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), `thirdeye-job-${job.jobId}-`));
    const baseDir = path.join(workspacePath, "base");
    const headDir = path.join(workspacePath, "head");
    const outDir = path.join(workspacePath, "out");

    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(headDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    return {
        workspacePath,
        baseDir,
        headDir,
        outDir,
        cleanup: async () => {
            await fs.rm(workspacePath, { recursive: true, force: true });
        },
    };
}

import type { ScanJob } from "@thirdeye/types";

export interface EphemeralWorkspace {
    workspacePath: string;
    baseDir: string;
    headDir: string;
    outDir: string;
    cleanup: () => Promise<void>;
}

/**
 * Manages the lifecycle of ephemeral host workspaces for scan jobs.
 */
export async function createJobWorkspace(job: ScanJob): Promise<EphemeralWorkspace> {
    // TODO: Create isolated temporary directory on host
    // TODO: Prepare subdirectories: base/, head/, out/
    // TODO: Return workspace paths and an idempotent cleanup callback

    throw new Error("Not implemented yet");
}


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

export async function createJobWorkspace(job: ScanJob): Promise<EphemeralWorkspace> {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), `thirdeye-job-${job.jobId}-`));
    const baseDir = path.join(workspacePath, "base");
    const headDir = path.join(workspacePath, "head");
    const outDir = path.join(workspacePath, "out");

    await Promise.all([
        fs.mkdir(outDir, { recursive: true }),
        fs.mkdir(baseDir, { recursive: true }),
        fs.mkdir(headDir, { recursive: true }),

    ]);

    return {
        workspacePath,
        baseDir,
        headDir,
        outDir,
        cleanup: async () => {
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
                console.log(`[JobManager] Cleaned up workspace: ${workspacePath}`);
            } catch (err) {
                console.error(`[JobManager] Failed to clean up workspace ${workspacePath}:`, err);
            }
        },
    };
}

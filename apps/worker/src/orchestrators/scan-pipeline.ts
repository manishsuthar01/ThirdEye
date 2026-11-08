import { ScanJob, ScanResult, SecurityDelta } from "@thirdeye/types";
import { createJobWorkspace } from "../sandbox/job-manager";
import { DockerSandboxRunner } from "../sandbox/runner-client";
import { calculateRiskScore } from "@thirdeye/analysis/src";
import { workerData } from "worker_threads";


const runnerClient = new DockerSandboxRunner();

export async function executeScanPipeline(job: ScanJob): Promise<void> {
    try {
        console.log(`[Pipeline] Starting scan pipeline for Job ${job.jobId} (${job.repository.slug})`);



        const workspace = await createJobWorkspace(job);
        try {

            console.log(`[Pipeline] Workspace allocated at: ${workspace.workspacePath}`);

            await runnerClient.fetchSources(job, workspace);

            const scanResult: ScanResult = await runnerClient.runScanners(job, workspace);

            // const delta: SecurityDelta = calculateRiskScore(scanResult)

            // step-1-> compartment 1: source Acquisition
            // Step 2: Compute Security Delta (@thirdeye/analysis)
            // Step 3: Persist to DB & Publish to GitHub Checks API (Milestone 3 & 4)
            // Step 4: Cleanup     


        } catch (error) {
            console.error(`[Pipeline] Job ${job.jobId} failed:`, error);
            throw error;
        } finally {
            await workspace.cleanup();
        }

    } catch (error) {
        console.error(`Failed to create workspace for job ${job.jobId}:`, error);
        return;
    }

} 
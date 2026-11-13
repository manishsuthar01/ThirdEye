import { ScanJob, ScanResult, SecurityDelta } from "@thirdeye/types";
import { createJobWorkspace } from "../sandbox/job-manager";
import { DockerSandboxRunner } from "../sandbox/runner-client";
import { calculateSecurityDelta, evaluateDeploymentGate, buildGitHubCheckPayload } from "@thirdeye/analysis";
import { GitHubChecksClient } from "../services/github-checks.client";

const runnerClient = new DockerSandboxRunner();
const checksClient = new GitHubChecksClient();

export async function executeScanPipeline(job: ScanJob): Promise<void> {
    const [owner, repo] = job.repository.slug.split("/");
    let checkRunId: number | null = null;

    try {
        console.log(`[Pipeline] Starting scan pipeline for Job ${job.jobId} (${job.repository.slug})`);

        // Step 0: Create initial in_progress Check Run on GitHub
        if (owner && repo && job.revisions.headSha) {
            checkRunId = await checksClient.createCheckRun(owner, repo, job.revisions.headSha);
        }

        const workspace = await createJobWorkspace(job);
        try {

            console.log(`[Pipeline] Workspace allocated at: ${workspace.workspacePath}`);

            await runnerClient.fetchSources(job, workspace);

            const scanResult: ScanResult = await runnerClient.runScanners(job, workspace);
            console.log("[Pipeline] Full Scan Report Output:\n", JSON.stringify(scanResult, null, 2));
            console.log(`[Pipeline] Scanners returned: ${scanResult.headFindings.length} findings in Head, ${scanResult.baseFindings.length} findings in Base`);

            // Step 2: Compute Security Delta and Deployment Gate Verdict (@thirdeye/analysis)
            const delta: SecurityDelta = calculateSecurityDelta(scanResult.baseFindings, scanResult.headFindings);
            const gate = evaluateDeploymentGate(delta);

            console.log("\n================ [SECURITY GATE VERDICT] ================");
            console.log(`Verdict:        ${gate.verdict}`);
            console.log(`Risk Score:     ${gate.score}`);
            console.log(`New Regressions: ${delta.new.length}`);
            console.log(`Resolved Issues: ${delta.resolved.length}`);
            console.log(`Persistent Debt: ${delta.persistent.length}`);
            console.log(`Worsened Issues: ${delta.worsened.length}`);
            if (gate.reasons.length > 0) {
                console.log("Reasons for Gate Decision:");
                gate.reasons.forEach((reason) => console.log(`  - ${reason}`));
            }
            console.log("=========================================================\n");

            // Step 3: Publish Verdict & Diff Annotations to GitHub (Checks API or Status + PR Comment)
            const [owner, repo] = job.repository.slug.split("/");
            if (owner && repo && job.revisions.headSha) {
                const checkPayload = buildGitHubCheckPayload(
                    job.revisions.headSha,
                    delta,
                    gate,
                    job.jobId
                );
                await checksClient.completeCheckRun(
                    owner,
                    repo,
                    job.revisions.headSha,
                    job.revisions.prNumber,
                    checkRunId,
                    checkPayload
                );
            }     


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
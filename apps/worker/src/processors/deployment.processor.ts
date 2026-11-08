import type { NormalizedWebhookEvent } from "../types/webHookEvent";
import type { ConsumeMessage } from "@thirdeye/queue";
import { createJobWorkspace } from "../sandbox/job-manager";
import { ScanJob } from "@thirdeye/types";
import { randomBytes, randomUUID, verify } from "crypto";
import { executeScanPipeline } from "../orchestrators/scan-pipeline";

export default async function processDeploymentEvent(
    event: NormalizedWebhookEvent,
    rawmsg?: ConsumeMessage
): Promise<void> {
    console.log(`[Processor] Ingested ${event.provider} event: ${event.eventType} (${event.triggerType})`);

    if (!event.commitSha) {
        console.warn(`[Processor] Skipping event ${event.triggerId}: No commit SHA found.`);
        return;
    }

    if (event.eventType === "pull_request") {
        console.log(`[Processor] PR #${event.metadata.prNumber} [${event.metadata.action}] on ${event.projectSlug}`);
        console.log(`[Processor] Base SHA: ${event.metadata.baseSha} -> Head SHA: ${event.commitSha}`);

        const { baseSha, headSha, cloneUrl, prNumber } = event.metadata;
        if (!baseSha || !headSha || !cloneUrl) {
            console.warn(`[Processor] Skipping PR #${prNumber}: missing baseSha, headSha, or cloneUrl`);
            return;
        }

        const job: ScanJob = {
            jobId: randomUUID(),
            repository: {
                id: event.projectId,
                slug: event.projectSlug,
                cloneUrl
            },
            revisions: {
                baseSha,
                headSha,
                prNumber
            },
            timeoutMs: 20 * 60 * 1000,
        }


        try {
            await executeScanPipeline(job)
        } catch (error) {
            console.error(`Failed to execute scan pipeline for job ${job.jobId}:`, error);
            return;
        }
    }

    if (event.eventType === "push") {
        console.log(`[Processor] Push to commit: ${event.commitSha} on ${event.projectSlug}`);
        return;
    }
}

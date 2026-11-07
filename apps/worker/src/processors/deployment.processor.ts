import type { NormalizedWebhookEvent } from "../types/webHookEvent";
import type { ConsumeMessage } from "@thirdeye/queue";

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

        // Milestone 1 & 2 Execution Flow:
        // 1. Prepare Base & Head workspace snapshots via Git CLI
        // 2. Invoke Scanner Runner (OpenGrep + Trivy adapters)
        // 3. Compute Security Delta (@thirdeye/analysis)
        // 4. Report via GitHub Checks API
        return;
    }

    if (event.eventType === "push") {
        console.log(`[Processor] Push to commit: ${event.commitSha} on ${event.projectSlug}`);
        return;
    }
}

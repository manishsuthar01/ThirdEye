import type { NormalizedWebhookEvent } from "../types/webHookEvent";
import { queueManager } from "../lib/queue";
import type { ConsumeMessage } from "@thirdeye/queue";

import { analyzeCommitJob } from "../jobs/analyzeCommitJob";


export default async function processDeploymentEvent(event: NormalizedWebhookEvent, rawmsg?: ConsumeMessage): Promise<void> {
    console.log("Processing deployment event:", event);

    if (!event.commitSha) {
        console.warn(`[Processor] Skipping event ${event.triggerId}: No commit SHA found.`);
        return;
    }

    await analyzeCommitJob(event);
}
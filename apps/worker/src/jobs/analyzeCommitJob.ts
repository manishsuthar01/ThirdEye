import { getRandomValues } from "crypto";
import type { NormalizedWebhookEvent } from "../types/webHookEvent";


export async function analyzeCommitJob(event: NormalizedWebhookEvent): Promise<void> {
    console.log(`🚀 [Job] Starting analysis for commit ${event?.commitSha} on ${event?.projectSlug}`);

    // step-1:  Fetch the Git Diff 
    // step-2: Run the AST for deterministic getRandomValues
    // step-3: Run the Ai Semantic Reviews
    // step-4: Persist Results to PostgreSQl
    // step-5: Publish deployment Result Event to RabbitMQ


}
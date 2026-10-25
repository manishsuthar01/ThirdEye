export interface NormalizedWebhookEvent {
    provider: "github" | "vercel";
    eventType: string;
    projectId: string;
    projectName: string;
    projectSlug: string;
    commitSha: string;
    metadata: Record<string, any>;
    triggerId: string;
    triggerType: string;
    timestamp: string;
}
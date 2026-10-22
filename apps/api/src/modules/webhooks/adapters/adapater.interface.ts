import { Request } from "express";

export interface NormalizedWebhookEvent {
    provider: "github" | "vercel";
    eventType: string;
    projectId: string;
    projectName: string;
    projectSlug: string;
    commitSha: string;
    metadata: Record<string, string | number | boolean | string[] | Record<string, any>>
    triggerId: string;
    triggerType: string;
    timestamp: Date;
}

export interface WebhookAdapter {
    getEventType(req: Request): string;
    normalize(req: Request): NormalizedWebhookEvent | null;
    getRoutingKey(req: Request): string;
}
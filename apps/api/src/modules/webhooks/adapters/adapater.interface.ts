import { Request } from "express";

export interface WebhookMetadata {
    // Pull Request Specific
    action?: string;
    prNumber?: number;
    title?: string;
    author?: string;
    baseSha?: string;
    baseRef?: string;
    headSha?: string;
    headRef?: string;
    cloneUrl?: string;
    installationId?: number;

    // Push Specific
    ref?: string;
    head?: string;
    before?: string;
    pusher?: string;
    compareUrl?: string;

    [key: string]: any;
}

export interface NormalizedWebhookEvent {
    provider: "github" | "vercel";
    eventType: string;
    projectId: string;
    projectName: string;
    projectSlug: string;
    commitSha: string;
    metadata: WebhookMetadata;
    triggerId: string;
    triggerType: string;
    timestamp: Date;
}

export interface WebhookAdapter {
    getEventType(req: Request): string;
    normalize(req: Request): NormalizedWebhookEvent | null;
    getRoutingKey(req: Request): string;
}

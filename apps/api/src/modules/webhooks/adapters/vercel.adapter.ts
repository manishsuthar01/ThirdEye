import { Request } from "express";
import { WebhookAdapter, NormalizedWebhookEvent } from "./adapater.interface";

export const vercelAdapter: WebhookAdapter = {
    getEventType(req: Request): string {
        return req.body?.type || "unknown";
    },

    getRoutingKey(req: Request): string {
        // e.g. req.body.type is "deployment.succeeded" -> "deployment.vercel.succeeded"
        const event = this.getEventType(req).replace("deployment.", "");
        return `deployment.vercel.${event}`;
    },

    normalize(req: Request): NormalizedWebhookEvent | null {
        const body = req.body;
        const deployment = body.payload?.deployment;

        if (!deployment) return null;

        return {
            provider: "vercel",
            eventType: body.type,
            projectId: body.payload?.projectId ?? "",
            projectName: body.payload?.name ?? "",
            projectSlug: deployment.name ?? "",
            // Vercel records the GitHub commit SHA right here:
            commitSha: deployment.meta?.githubCommitSha || "",
            metadata: {
                deploymentUrl: deployment.url,
                target: deployment.target, // "production" or "preview"
                readyState: deployment.readyState,
            },
            triggerId: body.id,
            triggerType: body.type,
            timestamp: new Date(body.createdAt || Date.now()),
        };
    }
};

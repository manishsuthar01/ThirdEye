import { Request } from "express";
import { NormalizedWebhookEvent, WebhookAdapter } from "./adapater.interface";

export const githubAdapter: WebhookAdapter = {
    getEventType(req: Request): string {
        return req.headers["x-github-event"] as string;
    },
    getRoutingKey(req: Request): string {
        const event = this.getEventType(req);
        return `deployment.github.${event}`
    },
    normalize(req: Request): NormalizedWebhookEvent | null {
        const event = this.getEventType(req)
        const body = req.body;
        const repo = body?.repository;
        if (event == "ping" || !repo) return null;
        return {
            provider: "github",
            eventType: event,
            projectId: repo.id?.toString() ?? "",
            projectName: repo.name ?? "",
            projectSlug: repo.full_name ?? "",
            commitSha: body.head_commit?.id || body.after || "",
            metadata: {
                ref: body.ref,
                head: body.head,
                before: body.before,
                pusher: body.pusher?.name,
                compareUrl: body.compare,
            },
            triggerId: (req.headers["x-github-delivery"] as string) || body.push_id?.toString() || "",
            triggerType: event,
            timestamp: typeof body.repository.pushed_at === "number"
                ? new Date(body.repository.pushed_at * 1000)
                : new Date()
        }
    }
}
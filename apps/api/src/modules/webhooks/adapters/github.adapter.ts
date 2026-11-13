import { Request } from "express";
import { NormalizedWebhookEvent, WebhookAdapter } from "./adapater.interface";

const RELEVANT_PR_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export const githubAdapter: WebhookAdapter = {
    getEventType(req: Request): string {
        return req.headers["x-github-event"] as string;
    },

    getRoutingKey(req: Request): string {
        const event = this.getEventType(req);
        return `deployment.github.${event}`;
    },

    normalize(req: Request): NormalizedWebhookEvent | null {
        const event = this.getEventType(req);
        const body = req.body;
        const repo = body?.repository;

        console.log(`\n[GitHubAdapter] Processing event: "${event}"`);

        // Ignore ping events and malformed payloads without a repository
        if (event === "ping") {
            console.log(`[GitHubAdapter] Ignored: Ping event received (hook setup confirmation)`);
            return null;
        }
        if (!repo) {
            console.warn(`[GitHubAdapter] Ignored: Request payload has no repository metadata`);
            return null;
        }

        console.log(`[GitHubAdapter] Repository: ${repo.full_name}`);

        // 1. Pull Request Events
        if (event === "pull_request") {
            const action = body.action;
            console.log(`[GitHubAdapter] PR Action: "${action}" (PR #${body.number})`);

            // Filter out non-code PR events (labels, assignments, reviews, etc.)
            if (!RELEVANT_PR_ACTIONS.has(action)) {
                console.log(`[GitHubAdapter] Ignored: PR action "${action}" is not in code-scanning set (${Array.from(RELEVANT_PR_ACTIONS).join(", ")})`);
                return null;
            }

            const pr = body.pull_request;
            if (!pr) {
                console.warn(`[GitHubAdapter] Ignored: "pull_request" event payload missing pull_request object`);
                return null;
            }

            console.log(`[GitHubAdapter] Accepted: PR #${body.number} [${action}] Base: ${pr.base?.ref} (${pr.base?.sha?.slice(0, 7)}) -> Head: ${pr.head?.ref} (${pr.head?.sha?.slice(0, 7)})`);

            return {
                provider: "github",
                eventType: "pull_request",
                projectId: repo.id?.toString() ?? "",
                projectName: repo.name ?? "",
                projectSlug: repo.full_name ?? "",
                commitSha: pr.head?.sha ?? "",
                metadata: {
                    action,
                    prNumber: body.number,
                    title: pr.title,
                    author: pr.user?.login,
                    baseSha: pr.base?.sha,
                    baseRef: pr.base?.ref,
                    headSha: pr.head?.sha,
                    headRef: pr.head?.ref,
                    cloneUrl: repo.clone_url,
                    installationId: body.installation?.id,
                },
                triggerId: (req.headers["x-github-delivery"] as string) || `${repo.id}-${body.number}-${pr.head?.sha}`,
                triggerType: `pull_request.${action}`,
                timestamp: pr.updated_at ? new Date(pr.updated_at) : new Date(),
            };
        }

        console.log(`[GitHubAdapter] Ignored: Event "${event}" is not handled for security delta scanning`);
        return null;

        // 2. Push Events
        if (event === "push") {
            return {
                provider: "github",
                eventType: "push",
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
                    cloneUrl: repo.clone_url,
                },
                triggerId: (req.headers["x-github-delivery"] as string) || body.push_id?.toString() || "",
                triggerType: "push",
                timestamp: typeof repo.pushed_at === "number"
                    ? new Date(repo.pushed_at * 1000)
                    : new Date(),
            };
        }

        // Ignore unhandled GitHub event types
        return null;
    },
};

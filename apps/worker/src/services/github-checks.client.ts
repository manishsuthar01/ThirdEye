import type { GitHubCheckPayload } from "@thirdeye/analysis";

export interface GitHubCheckClientOptions {
    token?: string;
    userAgent?: string;
}

export class GitHubChecksClient {
    private explicitToken?: string;
    private userAgent: string;

    constructor(options?: GitHubCheckClientOptions) {
        this.explicitToken = options?.token;
        this.userAgent = options?.userAgent || "ThirdEye-SecurityGate/1.0";
    }

    private getToken(): string {
        return this.explicitToken || process.env.GITHUB_TOKEN || "";
    }

    private getHeaders(): Record<string, string> {
        const token = this.getToken();
        return {
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": this.userAgent,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
    }

    /**
     * Publishes a Commit Status (Works with standard Personal Access Tokens).
     * Shows a green checkmark or red 'X' directly next to the commit on the PR.
     */
    async setCommitStatus(
        owner: string,
        repo: string,
        headSha: string,
        state: "pending" | "success" | "failure" | "error",
        description: string,
        context: string = "ThirdEye / Security Delta Gate"
    ): Promise<boolean> {
        const token = this.getToken();
        if (!token) return false;

        const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${headSha}`;
        const body = {
            state,
            description: description.slice(0, 140), // GitHub limit is 140 chars
            context,
        };

        try {
            console.log(`[GitHubStatus] Setting commit status to '${state}' on ${owner}/${repo}@${headSha.slice(0, 7)}...`);
            const response = await fetch(url, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const text = await response.text();
                console.warn(`[GitHubStatus] Failed to set status: HTTP ${response.status} - ${text}`);
                return false;
            }

            console.log(`[GitHubStatus] Commit status '${state}' successfully posted to GitHub!`);
            return true;
        } catch (err: any) {
            console.warn(`[GitHubStatus] Error setting status: ${err.message}`);
            return false;
        }
    }

    /**
     * Posts or updates the executive Markdown summary table directly as a Pull Request comment.
     */
    async postPRComment(
        owner: string,
        repo: string,
        prNumber: number,
        markdownBody: string
    ): Promise<boolean> {
        const token = this.getToken();
        if (!token || !prNumber) return false;

        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;

        try {
            console.log(`[GitHubPR] Posting security executive summary comment on PR #${prNumber}...`);
            const response = await fetch(url, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify({ body: markdownBody }),
            });

            if (!response.ok) {
                const text = await response.text();
                console.warn(`[GitHubPR] Failed to post PR comment: HTTP ${response.status} - ${text}`);
                return false;
            }

            console.log(`[GitHubPR] Security summary comment successfully posted on PR #${prNumber}!`);
            return true;
        } catch (err: any) {
            console.warn(`[GitHubPR] Error posting comment: ${err.message}`);
            return false;
        }
    }

    /**
     * Creates an initial Check Run in 'in_progress' state.
     * If forbidden (e.g. using PAT), falls back to setting Commit Status to 'pending'.
     */
    async createCheckRun(
        owner: string,
        repo: string,
        headSha: string,
        checkName: string = "ThirdEye / Security Delta Gate"
    ): Promise<number | null> {
        const token = this.getToken();
        if (!token) {
            console.warn(`[GitHubChecks] Skipped: GITHUB_TOKEN not configured in environment.`);
            return null;
        }

        const url = `https://api.github.com/repos/${owner}/${repo}/check-runs`;
        const body = {
            name: checkName,
            head_sha: headSha,
            status: "in_progress",
            started_at: new Date().toISOString(),
            output: {
                title: "Security Delta Scan in progress...",
                summary: "ThirdEye is running isolated SAST and SCA scanners across base and head snapshots.",
            },
        };

        try {
            console.log(`[GitHubChecks] Creating in_progress Check Run on ${owner}/${repo}@${headSha.slice(0, 7)}...`);
            const response = await fetch(url, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                // If HTTP 403 (PAT without GitHub App permission), fallback to Commit Status API
                if (response.status === 403) {
                    await this.setCommitStatus(owner, repo, headSha, "pending", "ThirdEye security delta scan in progress...");
                    return null;
                }
                const errorText = await response.text();
                console.warn(`[GitHubChecks] Failed to create Check Run: HTTP ${response.status} - ${errorText}`);
                return null;
            }

            const data = (await response.json()) as { id: number };
            console.log(`[GitHubChecks] Check Run created successfully (ID: ${data.id})`);
            return data.id;
        } catch (err: any) {
            console.warn(`[GitHubChecks] Error creating Check Run: ${err.message}`);
            return null;
        }
    }

    /**
     * Completes a Check Run with verdict, summary markdown, and diff annotations.
     * If Check Run is unauthorized, gracefully falls back to Commit Status API + PR Comment!
     */
    async completeCheckRun(
        owner: string,
        repo: string,
        headSha: string,
        prNumber: number | undefined,
        checkRunId: number | null,
        payload: GitHubCheckPayload
    ): Promise<boolean> {
        const token = this.getToken();
        if (!token) {
            console.warn(`[GitHubChecks] Skipped: GITHUB_TOKEN not configured in environment.`);
            return false;
        }

        // Try Check Runs API if checkRunId was created, or attempt direct post
        if (checkRunId !== null) {
            const url = `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`;
            try {
                const response = await fetch(url, {
                    method: "PATCH",
                    headers: this.getHeaders(),
                    body: JSON.stringify(payload),
                });

                if (response.ok) {
                    console.log(`[GitHubChecks] Check Run updated successfully on GitHub!`);
                    return true;
                }
            } catch {}
        }

        // --- Graceful Fallback for PAT (Commit Status + PR Comment) ---
        console.log(`[GitHubFeedback] Publishing verdict via Commit Status & PR Review Comment...`);

        const statusState: "success" | "failure" = payload.conclusion === "success" ? "success" : "failure";
        const description = payload.output.title;

        // 1. Post Commit Status (shows red 'X' or green checkmark on commit)
        await this.setCommitStatus(owner, repo, headSha, statusState, description, payload.name);

        // 2. Post Full Markdown Table to PR Conversation tab
        if (prNumber) {
            await this.postPRComment(owner, repo, prNumber, payload.output.summary);
        }

        return true;
    }
}

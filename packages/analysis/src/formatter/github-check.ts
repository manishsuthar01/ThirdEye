import type { SecurityDelta, SecurityFinding } from "@thirdeye/types";
import type { GateDecision } from "../scorer";

export interface GitHubCheckAnnotation {
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: "notice" | "warning" | "failure";
    message: string;
    title: string;
    raw_details?: string;
}

export interface GitHubCheckOutput {
    title: string;
    summary: string;
    text?: string;
    annotations: GitHubCheckAnnotation[];
}

export interface GitHubCheckPayload {
    name: string;
    head_sha: string;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
    started_at?: string;
    completed_at?: string;
    output: GitHubCheckOutput;
}

/**
 * Maps ThirdEye findings severity to GitHub Check Run annotation levels.
 */
function mapAnnotationLevel(severity: string): "notice" | "warning" | "failure" {
    switch (severity.toLowerCase()) {
        case "critical":
        case "high":
            return "failure";
        case "medium":
            return "warning";
        default:
            return "notice";
    }
}

/**
 * Transforms SecurityFinding regressions into GitHub diff annotations.
 * Note: GitHub API accepts at most 50 annotations per update call.
 */
export function formatFindingAnnotations(
    newFindings: SecurityFinding[],
    maxLimit: number = 50
): GitHubCheckAnnotation[] {
    const annotations: GitHubCheckAnnotation[] = [];

    for (const finding of newFindings) {
        if (!finding.location.file) continue;

        // GitHub requires start_line >= 1
        const startLine = Math.max(1, finding.location.startLine || 1);
        const endLine = Math.max(startLine, finding.location.endLine || startLine);

        annotations.push({
            path: finding.location.file,
            start_line: startLine,
            end_line: endLine,
            annotation_level: mapAnnotationLevel(finding.severity),
            title: `[${finding.severity.toUpperCase()}] ${finding.ruleId}`,
            message: finding.description || finding.title,
            raw_details: finding.evidence?.join("\n") || undefined,
        });

        if (annotations.length >= maxLimit) {
            break;
        }
    }

    return annotations;
}

/**
 * Generates an executive Markdown report for the GitHub Check Run summary page.
 */
export function formatMarkdownSummary(
    delta: SecurityDelta,
    gate: GateDecision,
    jobId: string
): string {
    const icon = gate.verdict === "BLOCK" ? "❌" : gate.verdict === "WARN" ? "⚠️" : "✅";
    const conclusionText =
        gate.verdict === "BLOCK"
            ? "**Deployment Blocked:** New security regressions were introduced in this pull request."
            : gate.verdict === "WARN"
                ? "**Deployment Warning:** Medium-risk findings detected. Review before merging."
                : "**Security Check Passed:** No new security regressions detected.";

    let md = `## ${icon} ThirdEye Security Gate: \`${gate.verdict}\`\n\n`;
    md += `${conclusionText}\n\n`;

    // Overview Table
    md += `### 📊 Analysis Summary\n\n`;
    md += `| Metric | Count | Description |\n`;
    md += `| :--- | :--- | :--- |\n`;
    md += `| 🚨 **New Regressions** | \`${delta.new.length}\` | Issues introduced in this PR |\n`;
    md += `| 📈 **Worsened Issues** | \`${delta.worsened.length}\` | Existing issues with escalated severity |\n`;
    md += `| 🛠️ **Resolved Fixes** | \`${delta.resolved.length}\` | Pre-existing debt eliminated by this PR |\n`;
    md += `| 📦 **Persistent Tech Debt** | \`${delta.persistent.length}\` | Existing baseline issues (not blocking) |\n`;
    md += `| ⚖️ **Deployment Risk Score** | \`${gate.score} pts\` | Weighted regression score |\n\n`;

    // Gate reasons
    if (gate.reasons.length > 0) {
        md += `### 🛑 Gating Reasons\n\n`;
        for (const reason of gate.reasons) {
            md += `- ${reason}\n`;
        }
        md += `\n`;
    }

    // Regressions Table
    if (delta.new.length > 0) {
        md += `### 🚨 Regressions Introduced (Fix Required)\n\n`;
        md += `| Severity | Rule ID | File | Description |\n`;
        md += `| :--- | :--- | :--- | :--- |\n`;

        for (const item of delta.new.slice(0, 20)) {
            const fileLink = item.location.file + (item.location.startLine ? `:${item.location.startLine}` : "");
            md += `| \`${item.severity.toUpperCase()}\` | \`${item.ruleId}\` | \`${fileLink}\` | ${item.title} |\n`;
        }

        if (delta.new.length > 20) {
            md += `\n*... and ${delta.new.length - 20} more regressions.*\n`;
        }
        md += `\n`;
    }

    // Resolved Table
    if (delta.resolved.length > 0) {
        md += `### 🎉 Security Improvements (Resolved)\n\n`;
        for (const item of delta.resolved.slice(0, 10)) {
            md += `- **[${item.severity.toUpperCase()}]** \`${item.ruleId}\` in \`${item.location.file}\`\n`;
        }
        md += `\n`;
    }

    md += `---\n*Generated by ThirdEye (Job \`${jobId}\`)*\n`;
    return md;
}

/**
 * Builds the complete GitHub Checks API payload for a completed run.
 */
export function buildGitHubCheckPayload(
    headSha: string,
    delta: SecurityDelta,
    gate: GateDecision,
    jobId: string,
    checkName: string = "ThirdEye / Security Delta Gate"
): GitHubCheckPayload {
    const conclusion =
        gate.verdict === "BLOCK"
            ? "failure"
            : gate.verdict === "WARN"
                ? "neutral"
                : "success";

    const title =
        gate.verdict === "BLOCK"
            ? `Security Gate Failed: ${delta.new.length} new regression(s)`
            : gate.verdict === "WARN"
                ? `Security Gate Warning: ${delta.new.length} warning(s)`
                : "Security Gate Passed: 0 regressions";

    const summary = formatMarkdownSummary(delta, gate, jobId);
    const annotations = formatFindingAnnotations(delta.new);

    return {
        name: checkName,
        head_sha: headSha,
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
            title,
            summary,
            annotations,
        },
    };
}


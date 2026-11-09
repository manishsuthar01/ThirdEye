/**
 * Source Fetcher Entry Point
 *
 * Responsibilities:
 * 1. Read configuration (target repo, clone URL, base SHA, head SHA, auth token).
 * 2. Download the base revision snapshot into /workspace/base.
 * 3. Download the head revision snapshot into /workspace/head.
 * 4. Exit cleanly with code 0 on success, or non-zero on error.
 */

import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";

export function parseRepoSlug(cloneUrl: string): { owner: string; repo: string } {
    const match = cloneUrl.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match || !match[1] || !match[2]) {
        throw new Error(`[SourceFetcher] Could not parse owner/repo from URL: ${cloneUrl}`);
    }
    return { owner: match[1], repo: match[2] };
}

export async function downloadAndExtractSnapshot(
    owner: string,
    repo: string,
    sha: string,
    targetDir: string,
    token?: string
): Promise<void> {
    const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`;
    console.log(`[SourceFetcher] Downloading ${owner}/${repo}@${sha} into ${targetDir}...`);

    const response = await fetch(url, {
        headers: {
            "User-Agent": "ThirdEye-SourceFetcher",
            "Accept": "application/vnd.github.v3+json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

    if (!response.ok || !response.body) {
        throw new Error(`[SourceFetcher] Failed to fetch tarball: HTTP ${response.status} ${response.statusText}`);
    }

    // Spawn the OS tar process to extract directly from stdin
    const tarProcess = spawn("tar", ["-xz", "-C", targetDir, "--strip-components=1"]);

    // Stream the HTTP response body directly into the tar process standard input
    // @ts-ignore
    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.pipe(tarProcess.stdin);

    return new Promise<void>((resolve, reject) => {
        tarProcess.on("close", (code) => {
            if (code === 0) {
                console.log(`[SourceFetcher] Extracted snapshot into ${targetDir}`);
                resolve();
            } else {
                reject(new Error(`[SourceFetcher] tar process failed with exit code ${code}`));
            }
        });

        tarProcess.on("error", (err) => {
            reject(new Error(`[SourceFetcher] Failed to spawn tar process: ${err.message}`));
        });
    });
}

async function main(): Promise<void> {
    console.log("[SourceFetcher] Starting source acquisition...");

    const cloneUrl = process.env.CLONE_URL;
    const baseSha = process.env.BASE_SHA;
    const headSha = process.env.HEAD_SHA;
    const token = process.env.GITHUB_TOKEN;
    const workspaceRoot = process.env.WORKSPACE_DIR || "/workspace";

    if (!cloneUrl || !baseSha || !headSha) {
        throw new Error("[SourceFetcher] Missing required environment variables (CLONE_URL, BASE_SHA, HEAD_SHA)");
    }

    const { owner, repo } = parseRepoSlug(cloneUrl);
    const baseDir = path.join(workspaceRoot, "base");
    const headDir = path.join(workspaceRoot, "head");

    // Ensure output directories exist on disk
    await Promise.all([
        fs.mkdir(baseDir, { recursive: true }),
        fs.mkdir(headDir, { recursive: true }),
    ]);

    // Download both revisions concurrently
    await Promise.all([
        downloadAndExtractSnapshot(owner, repo, baseSha, baseDir, token),
        downloadAndExtractSnapshot(owner, repo, headSha, headDir, token),
    ]);

    console.log("[SourceFetcher] All snapshots successfully acquired.");
}

main().catch((err) => {
    console.error("[SourceFetcher] Fatal error:", err);
    process.exit(1);
});

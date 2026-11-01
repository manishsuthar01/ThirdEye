export interface ChangedFile {
    filename: string;
    status: "added" | "modified" | "deleted";
    additions: number;
    deletions: number;
    patch?: string;
}

/**
 * Parses raw git diff / patch text into structured file changes.
 */
export function parseDiff(rawDiff: string): ChangedFile[] {
    // TODO: Parse unified diff hunks
    return [];
}


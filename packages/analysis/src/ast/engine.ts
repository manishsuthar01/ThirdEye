import type { SecurityFinding } from "../types";

/**
 * Runs AST-based deterministic security rules on source files.
 * Uses the native TypeScript Compiler API.
 */
export async function runAstAnalysis(
    filePath: string,
    fileContent: string
): Promise<SecurityFinding[]> {
    // TODO: Parse source into AST and run registered AST rules
    return [];
}


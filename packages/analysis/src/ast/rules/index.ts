import type { SecurityFinding } from "../../types";

export interface AstRule {
    id: string;
    name: string;
    description: string;
    check(sourceFile: any, filePath: string): SecurityFinding[];
}

export const registeredRules: AstRule[] = [];


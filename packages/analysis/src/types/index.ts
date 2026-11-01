export type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface SecurityFinding {
    ruleId: string;
    title: string;
    description: string;
    severity: SeverityLevel;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    snippet?: string;
    suggestion?: string;
}

export interface AnalysisResult {
    commitSha: string;
    riskScore: number; // 0 - 100
    findings: SecurityFinding[];
    analyzedFilesCount: number;
    timestamp: Date;
}


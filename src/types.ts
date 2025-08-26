// Shared types for Flink SQL Workbench extension

/**
 * Result structure expected by ResultsWebviewProvider
 * This interface bridges between new ExecutionResult and legacy provider expectations
 */
export interface QueryResult {
    columns: Array<{
        name: string;
        logicalType: {
            type: string;
            nullable: boolean;
        };
    }>;
    results: any[];
    executionTime: number;
    affectedRows?: number;
    error?: string;
}

/**
 * Legacy session info structure for backward compatibility
 */
export interface SessionInfo {
    sessionHandle: string;
    sessionName: string;
    created: Date;
}

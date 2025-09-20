// Shared types for Flink SQL Workbench extension
import * as vscode from 'vscode';

/**
 * Unified column information interface
 */
export interface ColumnInfo {
    name: string;
    logicalType: {
        type: string;
        nullable: boolean;
    };
}

/**
 * Execution metrics for tracking performance
 */
export interface ExecutionMetrics {
    startTime: number;
    endTime?: number;
    duration: number;
    rowCount?: number;
    executionTime: number;
}

/**
 * Unified result interface that replaces both QueryResult and ExecutionResult
 */
export interface UnifiedResult {
    columns: ColumnInfo[];
    data: any[];
    metadata: ExecutionMetrics;
    status: 'success' | 'error' | 'cancelled' | 'running' | 'completed';
    error?: string;
    affectedRows?: number;
}

/**
 * Legacy QueryResult interface for backward compatibility
 * @deprecated Use UnifiedResult instead
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
    isStreaming?: boolean;
}

/**
 * Consolidated connection configuration
 */
export interface FlinkConnection {
    id: string;
    name: string;
    url: string;
    type: 'flink-gateway' | 'flink';
    authType?: 'basic' | 'token' | 'none';
    credentials?: {
        username?: string;
        password?: string;
        apiToken?: string;
    };
}

/**
 * Session information with enhanced metadata
 */
export interface SessionInfo {
    sessionHandle: string;
    sessionName: string;
    created: Date;
    properties?: Record<string, string>;
    isActive: boolean;
    lastActivity?: Date;
}

/**
 * Job information interface
 */
export interface FlinkJob {
    id: string;
    name: string;
    status: 'RUNNING' | 'FINISHED' | 'CANCELED' | 'CANCELLED' | 'FAILED' | 'CREATED' | 'SUSPENDED';
    startTime: string;
    endTime?: string;
    duration?: string;
    type?: string;
    lastModification?: string;
}

/**
 * Catalog structure for tree view
 */
export interface CatalogInfo {
    name: string;
    type: 'catalog' | 'database' | 'table' | 'column';
    children?: CatalogInfo[];
    metadata?: Record<string, any>;
}

/**
 * Statement execution state
 */
export interface StatementState {
    id: string;
    statement: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'CANCELLED';
    startTime: number;
    endTime?: number;
    operationHandle?: string;
    result?: UnifiedResult;
    error?: string;
}

/**
 * Configuration interfaces
 */
export interface GatewayConfig {
    connectionId?: string;
    useProxy: boolean;
    timeout: number;
    maxRetries?: number;
}

export interface SessionConfig {
    properties: Record<string, string>;
    autoRefresh: boolean;
    idleTimeout?: string;
}

export interface JobsConfig {
    autoRefresh: boolean;
    refreshInterval: number;
    maxJobs?: number;
}

/**
 * Event types for the extension
 */
export interface ExtensionEvent {
    type: 'session' | 'statement' | 'connection' | 'job';
    action: 'created' | 'updated' | 'deleted' | 'error';
    data?: any;
    timestamp: number;
}

/**
 * Tree item types for providers
 */
export type TreeItemType = 'session' | 'job' | 'catalog' | 'connection' | 'group';

export interface BaseTreeItem {
    id: string;
    label: string;
    type: TreeItemType;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
    collapsibleState?: vscode.TreeItemCollapsibleState;
}

/**
 * Utility type for converting legacy interfaces to new ones
 */
export type LegacyToUnified<T> = T extends QueryResult ? UnifiedResult : T;

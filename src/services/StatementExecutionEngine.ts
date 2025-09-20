import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { FlinkApiService } from './FlinkApiService';
import { SecretProcessor, SecretProcessingError } from './SecretProcessor';
import { createModuleLogger } from './logger';

const log = createModuleLogger('StatementExecutionEngine');

export interface ColumnInfo {
    name: string;
    logicalType: {
        type: string;
        nullable: boolean;
    };
}

export interface ExecutionState {
    statementExecutionState: 'STOPPED' | 'RUNNING';
    resultType: string;
    resultKind: string;
    results: any[];
    columns: ColumnInfo[];
    lastUpdateTime: number | null;
}

export interface ExecutionResult {
    status: 'COMPLETED' | 'CANCELLED' | 'ERROR';
    message: string;
    statementId: string;
    state: ExecutionState;
    error?: string;
}

export interface StatementNotification {
    statementId: string;
    operationHandle: string | null;
    state: ExecutionState;
    timestamp: number;
}

/**
 * StatementExecutionEngine - Manages individual SQL statement execution
 * Handles statement submission, polling, cancellation, and result management
 * Allows concurrent execution of multiple statements
 */
export class StatementExecutionEngine {
    private sessionManager: SessionManager;
    private flinkApi: FlinkApiService;
    public readonly statementId: string;
    public operationHandle: string | null = null;
    private cancelled: boolean = false;
    private outputChannel: vscode.OutputChannel;
    private originalStatement: string = '';
    
    // State structure as requested
    private state: ExecutionState = {
        statementExecutionState: 'STOPPED',
        resultType: 'EOS',
        resultKind: 'SUCCESS',
        results: [],
        columns: [],
        lastUpdateTime: null
    };
    
    private observers = new Set<(notification: StatementNotification) => void>();
    private currentPollingLoop: Promise<ExecutionResult> | null = null;

    constructor(sessionManager: SessionManager, flinkApi: FlinkApiService, statementId?: string) {
        this.sessionManager = sessionManager;
        this.flinkApi = flinkApi;
        this.statementId = statementId || this.generateStatementId();
        this.outputChannel = vscode.window.createOutputChannel(`Flink Statement ${this.statementId}`);
        
        log.debug(`Created StatementExecutionEngine: ${this.statementId}`);
    }

    // Generate a unique statement ID
    private generateStatementId(): string {
        return `stmt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Add observer for this statement's results
    addObserver(observer: (notification: StatementNotification) => void): void {
        this.observers.add(observer);
        log.debug(`Added observer for statement ${this.statementId}, total: ${this.observers.size}`);
        
        // Send current state immediately
        if (this.state.results.length > 0 || this.state.statementExecutionState === 'RUNNING') {
            try {
                observer(this.createNotificationState());
            } catch (error: any) {
                log.error(`Error notifying new observer: ${error.message}`);
            }
        }
    }

    // Remove observer
    removeObserver(observer: (notification: StatementNotification) => void): void {
        this.observers.delete(observer);
        log.debug(`Removed observer for statement ${this.statementId}, remaining: ${this.observers.size}`);
    }

    // Create state object for notifications
    private createNotificationState(): StatementNotification {
        return {
            statementId: this.statementId,
            operationHandle: this.operationHandle,
            state: { ...this.state },
            timestamp: Date.now()
        };
    }

    // Notify all observers
    private notifyObservers(): void {
        const notificationState = this.createNotificationState();
        this.observers.forEach(observer => {
            try {
                observer(notificationState);
            } catch (error: any) {
                log.error(`Error in observer for statement ${this.statementId}: ${error.message}`);
            }
        });
    }

    // Update internal state and notify observers
    private updateState(updates: Partial<ExecutionState>): void {
        const hasChanges = Object.keys(updates).some(key => 
            JSON.stringify(this.state[key as keyof ExecutionState]) !== JSON.stringify(updates[key as keyof ExecutionState])
        );
        
        if (hasChanges) {
            Object.assign(this.state, updates);
            this.state.lastUpdateTime = Date.now();
            this.notifyObservers();
        }
    }

    // Helper method to compare two rows for equality (used in UPDATE_BEFORE and DELETE operations)
    private rowsMatch(row1: any, row2: any): boolean {
        // Simple deep comparison of all properties
        const keys1 = Object.keys(row1).sort();
        const keys2 = Object.keys(row2).sort();
        
        // Check if they have the same number of properties
        if (keys1.length !== keys2.length) {
            return false;
        }
        
        // Check if all keys match
        if (!keys1.every((key, index) => key === keys2[index])) {
            return false;
        }
        
        // Check if all values match
        return keys1.every(key => {
            const val1 = row1[key];
            const val2 = row2[key];
            
            // Handle null/undefined comparison
            if (val1 === null && val2 === null) {return true;}
            if (val1 === undefined && val2 === undefined) {return true;}
            if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) {return false;}
            
            // For primitive values, use strict equality
            if (typeof val1 !== 'object' && typeof val2 !== 'object') {
                return val1 === val2;
            }
            
            // For objects, use JSON comparison (simple but effective for this use case)
            try {
                return JSON.stringify(val1) === JSON.stringify(val2);
            } catch (error) {
                // Fallback to reference equality if JSON serialization fails
                return val1 === val2;
            }
        });
    }

    // Execute SQL statement
    async executeSQL(statement: string): Promise<ExecutionResult> {
        const truncatedStatement = statement.length > 100 ? 
            `${statement.substring(0, 100)}...` : statement;
        log.info(`Starting execution for statement ${this.statementId}: ${truncatedStatement}`);
        
        // Store the original statement for streaming detection
        this.originalStatement = statement;
        
        // Reset state for new execution
        this.cancelled = false;
        this.operationHandle = null;
        this.updateState({
            statementExecutionState: 'RUNNING',
            resultType: 'EOS',
            resultKind: 'SUCCESS',
            results: [],
            columns: []
        });

        try {
            // Process secret references in the statement if enabled
            let processedStatement = statement;
            if (SecretProcessor.isEnabled()) {
                try {
                    // Validate first if validation is enabled
                    if (SecretProcessor.isValidationEnabled()) {
                        const validation = SecretProcessor.validateStatement(statement);
                        if (!validation.isValid) {
                            const missingVars = validation.missingEnvVars.join(', ');
                            const errorMsg = `Missing environment variables for secret references: ${missingVars}`;
                            log.error(`Validation failed for statement ${this.statementId}: ${errorMsg}`);
                            this.updateState({
                                statementExecutionState: 'STOPPED',
                                resultType: 'ERROR',
                                resultKind: 'ERROR'
                            });
                            throw new Error(errorMsg);
                        }
                        log.debug(`Secret validation passed for statement ${this.statementId}: ${validation.secretReferences.length} reference(s)`);
                    }

                    // Process the statement
                    processedStatement = SecretProcessor.processStatement(statement);
                    if (processedStatement !== statement) {
                        log.info(`Processed secret references in statement ${this.statementId}`);
                    }
                } catch (error: any) {
                    if (error instanceof SecretProcessingError) {
                        log.error(`Secret processing failed for statement ${this.statementId}: ${error.message}`);
                        this.updateState({
                            statementExecutionState: 'STOPPED',
                            resultType: 'ERROR',
                            resultKind: 'ERROR'
                        });
                        throw new Error(`Secret processing failed: ${error.message}`);
                    }
                    throw error;
                }
            }

            // Get session from session manager
            const session = await this.sessionManager.getSession();
            
            if (!session || !session.sessionHandle) {
                log.error('No active connection found! Unable to get a valid session handle.');
                throw new Error('No active connection found! Please connect to a Flink server first.');
            }
            
            // Validate session
            const isValid = await this.sessionManager.validateSession();
            if (!isValid) {
                log.info('Session invalid, creating new one...');
                await this.sessionManager.createSession();
                
                // Get the new session and verify it has a handle
                const newSession = this.sessionManager.getSessionInfo();
                if (!newSession || !newSession.sessionHandle) {
                    log.error('Failed to create a valid session with a session handle');
                    throw new Error('Failed to create a valid connection. Please check your connection settings and try again.');
                }
            }

            // Submit statement (use processed statement with resolved secrets)
            log.info(`Submitting statement ${this.statementId}...`);
            const operationResponse = await this.flinkApi.submitStatement(session.sessionHandle, processedStatement);
            this.operationHandle = operationResponse.operationHandle;
            log.info(`Operation submitted with handle: ${this.operationHandle}`);

            // Start polling for results directly (like the working web app)
            console.log(`[DEBUG] Starting direct result polling for statement ${this.statementId} with operation handle: ${this.operationHandle}`);
            this.currentPollingLoop = this.pollForResults(session.sessionHandle);
            console.log(`[DEBUG] Result polling assigned, now awaiting completion for statement ${this.statementId}`);
            const result = await this.currentPollingLoop;
            console.log(`[DEBUG] Result polling completed for statement ${this.statementId}, result:`, result);
            
            return result;

        } catch (error: any) {
            console.error(`[DEBUG] Execution failed for statement ${this.statementId}:`, {
                error: error.message,
                stack: error.stack,
                operationHandle: this.operationHandle
            });
            log.error(`Execution failed for statement ${this.statementId}: ${error.message}`);
            
            this.updateState({
                statementExecutionState: 'STOPPED',
                resultType: 'ERROR',
                resultKind: 'ERROR'
            });
            
            throw error;
        }
    }

    // Direct result polling (matches working web app approach)
    private async pollForResults(sessionHandle: string): Promise<ExecutionResult> {
        console.log(`[DEBUG] Starting pollForResults for statement ${this.statementId} with operation handle: ${this.operationHandle}`);
        
        let nextToken = 0;
        let shouldContinue = true;
        
        console.log(`[DEBUG] Entering polling loop for statement ${this.statementId}`);
        
        while (shouldContinue && !this.cancelled) {
            console.log(`[DEBUG] Polling with token ${nextToken} for statement ${this.statementId}`);
            
            try {
                const response = await this.flinkApi.getOperationResults(sessionHandle, this.operationHandle!, nextToken);
                
                console.log(`[DEBUG] Response for statement ${this.statementId}:`, {
                    resultType: response.resultType,
                    resultKind: response.resultKind,
                    hasResults: !!response.results,
                    columnsCount: response.results?.columns?.length || 0,
                    dataCount: response.results?.data?.length || 0,
                    nextResultUri: response.nextResultUri
                });
                
                if (this.cancelled) {
                    log.warn(`Operation cancelled during API call - stopping for statement ${this.statementId}`);
                    break;
                }
                
                // Update state with response data
                const stateUpdates: Partial<ExecutionState> = {
                    resultType: response.resultType,
                    resultKind: response.resultKind
                };

                // Handle columns (only set once) - matches web app
                if (response.results && !this.state.columns.length) {
                    const columns = response.results.columns || response.results.columnInfos || [];
                    if (columns.length > 0) {
                        stateUpdates.columns = [...columns];
                        log.debug(`Found ${columns.length} columns for statement ${this.statementId}`);
                    }
                }

                // Handle data for SUCCESS_WITH_CONTENT - matches web app
                if (response.resultKind === 'SUCCESS_WITH_CONTENT' && response.results?.data && !this.cancelled) {
                    const newRows = response.results.data;
                    
                    if (newRows.length > 0) {
                        log.debug(`Processing ${newRows.length} rows for statement ${this.statementId}`);
                        
                        // Apply changelog operations to the current result set (matches web app)
                        let updatedResults = [...this.state.results];
                        
                        for (const row of newRows) {
                            if (this.cancelled) {
                                break;
                            }
                            
                            if (row.fields && Array.isArray(row.fields)) {
                                // Convert fields to row object (matches web app)
                                const rowObject: any = {};
                                row.fields.forEach((value: any, index: number) => {
                                    const columnName = this.state.columns[index]?.name || `column_${index}`;
                                    rowObject[columnName] = value;
                                });
                                
                                // Apply the change operation based on the 'kind' field (matches web app)
                                switch (row.kind) {
                                    case 'INSERT':
                                        updatedResults.push(rowObject);
                                        break;
                                    case 'UPDATE_BEFORE':
                                        // Remove old version
                                        const beforeIndex = updatedResults.findIndex(existingRow => 
                                            this.rowsMatch(existingRow, rowObject)
                                        );
                                        if (beforeIndex !== -1) {
                                            updatedResults.splice(beforeIndex, 1);
                                        }
                                        break;
                                    case 'UPDATE_AFTER':
                                        updatedResults.push(rowObject);
                                        break;
                                    case 'DELETE':
                                        const deleteIndex = updatedResults.findIndex(existingRow => 
                                            this.rowsMatch(existingRow, rowObject)
                                        );
                                        if (deleteIndex !== -1) {
                                            updatedResults.splice(deleteIndex, 1);
                                        }
                                        break;
                                    default:
                                        // Treat unknown kinds as INSERT (matches web app)
                                        updatedResults.push(rowObject);
                                        break;
                                }
                            }
                        }
                        
                        stateUpdates.results = updatedResults;
                    }
                }

                // Update state and notify observers
                this.updateState(stateUpdates);

                // Check continuation (matches web app exactly)
                if (response.resultType === 'EOS') {
                    console.log(`[DEBUG] Received EOS - stopping for statement ${this.statementId}`);
                    shouldContinue = false;
                } else if (response.nextResultUri) {
                    const tokenMatch = response.nextResultUri.match(/result\/(\d+)/);
                    if (tokenMatch) {
                        nextToken = parseInt(tokenMatch[1]);
                        console.log(`[DEBUG] More results available, continuing with token ${nextToken} for statement ${this.statementId}`);
                    } else {
                        console.log(`[DEBUG] Could not parse nextResultUri, stopping for statement ${this.statementId}`);
                        shouldContinue = false;
                    }
                } else {
                    console.log(`[DEBUG] No more results, stopping for statement ${this.statementId}`);
                    shouldContinue = false;
                }

                // Only sleep if we're continuing to poll
                if (shouldContinue && !this.cancelled) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error: any) {
                console.error(`[DEBUG] Error polling for results for statement ${this.statementId}:`, error);
                log.error(`Error polling for results for statement ${this.statementId}: ${error.message}`);
                throw error;
            }
        }

        // Final completion state (matches web app)
        this.updateState({
            statementExecutionState: 'STOPPED'
        });

        console.log(`[DEBUG] Polling completed for statement ${this.statementId}`);

        return {
            status: 'COMPLETED',
            message: `Statement completed. Type: ${this.state.resultType}, Kind: ${this.state.resultKind}`,
            statementId: this.statementId,
            state: { ...this.state }
        };
    }
    // Sleep with periodic cancellation checks
    private async sleepWithCancellationCheck(milliseconds: number): Promise<void> {
        const sleepStartTime = Date.now();
        while (Date.now() - sleepStartTime < milliseconds && !this.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 50)); // 50ms chunks
        }
    }

    // Cancel the current operation
    async cancel(): Promise<{ success: boolean; message: string }> {
        log.info(`Cancelling statement execution for ${this.statementId}`);
        this.cancelled = true;
        
        // If we have an active polling loop, let it handle the cancellation
        if (this.currentPollingLoop) {
            try {
                await this.currentPollingLoop;
            } catch (error) {
                // Ignore errors from cancelled operations
            }
        }
        
        return { success: true, message: 'Statement execution cancelled' };
    }

    // Get current state
    getState(): {
        statementId: string;
        operationHandle: string | null;
        cancelled: boolean;
        state: ExecutionState;
    } {
        return {
            statementId: this.statementId,
            operationHandle: this.operationHandle,
            cancelled: this.cancelled,
            state: { ...this.state }
        };
    }

    // Check if statement is currently running
    isRunning(): boolean {
        return this.state.statementExecutionState === 'RUNNING';
    }

    // Check if statement was cancelled
    isCancelled(): boolean {
        return this.cancelled;
    }
    
    // Determine if this is a streaming query based on the SQL and session properties
    isStreamingQuery(): boolean {
        // Check statement properties
        const sql = this.originalStatement.toLowerCase() || '';
        
        // If it contains streaming keywords or table definition with streaming elements, consider it streaming
        const streamingKeywords = [
            'create table',
            'insert into',
            'watermark',
            'proctime',
            'rowtime',
            'tumble',
            'hop',
            'session',
            'group by',
            'window',
            'stream'
        ];
        
        // Check if the query contains any streaming keywords
        const hasStreamingKeywords = streamingKeywords.some(keyword => sql.includes(keyword));
        
        // Check if the query seems to be a streaming source-to-sink operation
        const isInsertOrCreate = sql.includes('insert into') || (sql.includes('create') && sql.includes('table'));
        
        // Check session properties (if we can access them)
        let streamingMode = false;
        try {
            const sessionInfo = this.sessionManager.getSessionInfo();
            const properties = sessionInfo?.properties || {};
            
            // Check for common Flink streaming mode properties
            if (properties['execution.runtime-mode'] === 'streaming' || 
                properties['execution.type'] === 'streaming' ||
                properties['stream'] === 'true') {
                streamingMode = true;
            }
        } catch (e) {
            // Ignore errors accessing session properties
        }
        
        // If either the SQL or session properties indicate streaming, consider it a streaming query
        return hasStreamingKeywords || isInsertOrCreate || streamingMode;
    }

    // Show output
    showOutput(): void {
        this.outputChannel.show();
    }

    // Dispose resources
    dispose(): void {
        this.cancelled = true;
        this.observers.clear();
        this.outputChannel.dispose();
    }
}

import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { StatementExecutionEngine, ExecutionResult, StatementNotification } from './StatementExecutionEngine';
import { FlinkApiService } from './FlinkApiService';
import { createModuleLogger } from './logger';
import { GlobalSessionState } from './GlobalSessionState';

const log = createModuleLogger('StatementManager');

export interface GlobalStatementEvent {
    type: 'lifecycle' | 'statement_update';
    eventType?: 'statement_started' | 'statement_completed' | 'statement_error' | 'statement_cancelled' | 'all_statements_cancelled';
    statementId?: string;
    statement?: string;
    result?: ExecutionResult;
    error?: string;
    timestamp: number;
    // For statement_update events
    operationHandle?: string | null;
    state?: any;
}

/**
 * StatementManager - Orchestrates session management and statement execution
 * Allows concurrent execution of multiple statements using the same session
 */
export class StatementManager {
    private flinkApi: FlinkApiService;
    private sessionManager: SessionManager;
    private globalSessionState: GlobalSessionState;
    private activeStatements = new Map<string, StatementExecutionEngine>();
    private globalObservers = new Set<(event: GlobalStatementEvent) => void>();
    private outputChannel: vscode.OutputChannel;

    constructor(flinkApi: FlinkApiService) {
        this.flinkApi = flinkApi;
        this.sessionManager = SessionManager.getInstance(flinkApi);
        this.globalSessionState = GlobalSessionState.getInstance();
        this.outputChannel = vscode.window.createOutputChannel('Flink Statement Manager');
        
        log.info('StatementManager initialized');
    }
    
    /**
     * Update the FlinkApiService instance
     * Used when connection changes in SimpleConnection
     */
    setFlinkApi(flinkApi: FlinkApiService): void {
        log.info('Updating FlinkApiService in StatementManager');
        this.flinkApi = flinkApi;
        
        // Cancel all active statements when API changes
        this.cancelAllStatements();
    }

    // Add global observer for all statement events
    addGlobalObserver(observer: (event: GlobalStatementEvent) => void): void {
        this.globalObservers.add(observer);
        log.debug(`Added global observer, total: ${this.globalObservers.size}`);
    }

    // Remove global observer
    removeGlobalObserver(observer: (event: GlobalStatementEvent) => void): void {
        this.globalObservers.delete(observer);
        log.debug(`Removed global observer, remaining: ${this.globalObservers.size}`);
    }

    // Notify global observers
    private notifyGlobalObservers(event: GlobalStatementEvent): void {
        this.globalObservers.forEach(observer => {
            try {
                // Validate event structure before passing to observer
                if (!event) {
                    log.warn('Null event passed to observer');
                    return;
                }
                
                // Handle lifecycle events (type: 'lifecycle')
                if (event.type === 'lifecycle') {
                    if (!event.eventType || !event.statementId) {
                        log.warn(`Invalid lifecycle event structure: ${JSON.stringify(event)}`);
                        return;
                    }
                }
                // Handle state events (type: 'statement_update')
                else if (event.type === 'statement_update') {
                    if (!event.state) {
                        log.warn(`Invalid state event structure: ${JSON.stringify(event)}`);
                        return;
                    }
                }
                // Handle legacy events (no type field)
                else if (!event.state && event.type !== 'lifecycle') {
                    log.warn(`Unknown event structure: ${JSON.stringify(event)}`);
                    return;
                }
                
                observer(event);
            } catch (error: any) {
                log.error(`Error in global observer: ${error.message}`);
                log.error(`Event that caused error: ${JSON.stringify(event)}`);
            }
        });
    }

    // Session management methods (delegated to SessionManager)
    addSessionListener(callback: (sessionInfo: any) => void): void {
        return this.sessionManager.addListener(callback);
    }

    removeSessionListener(callback: (sessionInfo: any) => void): void {
        return this.sessionManager.removeListener(callback);
    }

    getSessionInfo(): any {
        return this.sessionManager.getSessionInfo();
    }

    updateSessionProperties(newProperties: Record<string, string>): void {
        return this.sessionManager.updateSessionProperties(newProperties);
    }

    async createSession(customProperties: Record<string, string> = {}): Promise<any> {
        return this.sessionManager.createSession(customProperties);
    }

    async getSession(): Promise<any> {
        return this.sessionManager.getSession();
    }

    async validateSession(): Promise<boolean> {
        return this.sessionManager.validateSession();
    }

    async closeSession(): Promise<void> {
        // Cancel all active statements before closing session
        log.info(`Cancelling ${this.activeStatements.size} active statements before closing session`);
        
        const cancellationPromises = Array.from(this.activeStatements.values()).map(async (engine) => {
            try {
                await engine.cancel();
            } catch (error: any) {
                log.error(`Error cancelling statement ${engine.statementId}: ${error.message}`);
            }
        });
        
        await Promise.allSettled(cancellationPromises);
        this.activeStatements.clear();
        
        return this.sessionManager.closeSession();
    }

    async refreshSession(): Promise<any> {
        // Cancel all active statements before refreshing
        await this.closeSession();
        return this.sessionManager.createSession();
    }

    getSessionAge(): string {
        return this.sessionManager.getSessionAge();
    }

    // Execute SQL statement (creates a new StatementExecutionEngine)
    async executeSQL(statement: string, statementId?: string): Promise<ExecutionResult> {
        // Check if we have a valid connection before proceeding
        if (!this.flinkApi) {
            const errorMessage = 'No Flink API service available. Please connect to a Flink gateway first.';
            log.error(errorMessage);
            
            // Show an informative message to the user
            vscode.window.showErrorMessage(errorMessage);
            
            return {
                status: 'ERROR',
                message: errorMessage,
                statementId: statementId || `statement_${Date.now()}`,
                error: errorMessage,
                state: {
                    columns: [],
                    results: [],
                    statementExecutionState: 'STOPPED',
                    resultType: 'UNKNOWN',
                    resultKind: 'UNKNOWN',
                    lastUpdateTime: Date.now()
                }
            };
        }
        
        // Ensure we have a valid session
        try {
            // First check global session state
            const activeSession = this.globalSessionState.getActiveSession();
            if (activeSession) {
                log.info(`Using active session from global state: ${activeSession.sessionName}`);
                
                // Verify the session is still valid
                const isValid = await this.globalSessionState.validateActiveSession(this.sessionManager);
                if (!isValid) {
                    log.info('Active session in global state is not valid, creating a new one');
                    await this.globalSessionState.setActiveSessionFromManager(this.sessionManager);
                }
            } else {
                log.info('No active session found in global state, checking session manager');
                
                if (!this.sessionManager.isConnected()) {
                    log.info('No active session found in session manager, creating one automatically');
                    await this.sessionManager.getSession();
                }
                
                // Update the global session state with the session from the manager
                await this.globalSessionState.setActiveSessionFromManager(this.sessionManager);
            }
            
            // Ensure we have a valid session handle after all this
            if (!this.sessionManager.getCurrentSessionHandle()) {
                throw new Error('Failed to obtain a valid session handle');
            }
        } catch (error: any) {
            const errorMessage = `Failed to create or validate session: ${error?.message || 'Unknown error'}`;
            log.error(errorMessage);
            
            // Show an informative message to the user
            vscode.window.showErrorMessage(errorMessage);
            
            return {
                status: 'ERROR',
                message: errorMessage,
                statementId: statementId || `statement_${Date.now()}`,
                error: errorMessage,
                state: {
                    columns: [],
                    results: [],
                    statementExecutionState: 'STOPPED',
                    resultType: 'UNKNOWN',
                    resultKind: 'UNKNOWN',
                    lastUpdateTime: Date.now()
                }
            };
        }
        
        // Verify that we have a valid session handle before proceeding
        const currentSessionHandle = this.sessionManager.getCurrentSessionHandle();
        if (!currentSessionHandle) {
            const errorMessage = 'No active connection found! Unable to get a valid session handle.';
            log.error(errorMessage);
            
            // Show an informative message to the user
            vscode.window.showErrorMessage(errorMessage);
            
            return {
                status: 'ERROR',
                message: errorMessage,
                statementId: statementId || `statement_${Date.now()}`,
                error: errorMessage,
                state: {
                    columns: [],
                    results: [],
                    statementExecutionState: 'STOPPED',
                    resultType: 'UNKNOWN',
                    resultKind: 'UNKNOWN',
                    lastUpdateTime: Date.now()
                }
            };
        }
        
        const engine = new StatementExecutionEngine(
            this.sessionManager, 
            this.flinkApi, 
            statementId
        );
        
        // Store the active statement
        this.activeStatements.set(engine.statementId, engine);
        
        log.info(`Created new statement execution engine: ${engine.statementId}`);
        
        // Add internal observer to track completion and remove from active list
        engine.addObserver((notification: StatementNotification) => {
            // Forward to global observers
            this.notifyGlobalObservers({
                type: 'statement_update',
                statementId: notification.statementId,
                operationHandle: notification.operationHandle,
                state: notification.state,
                timestamp: notification.timestamp
            });
            
            // Remove from active statements when completed
            if (notification.state.statementExecutionState === 'STOPPED') {
                this.activeStatements.delete(engine.statementId);
                log.info(`Statement ${engine.statementId} completed and removed from active list`);
            }
        });
        
        try {
            // Notify global observers that a new statement started
            this.notifyGlobalObservers({
                type: 'lifecycle',
                eventType: 'statement_started',
                statementId: engine.statementId,
                statement: statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
                timestamp: Date.now()
            });
            
            const result = await engine.executeSQL(statement);
            
            // Notify global observers of completion
            this.notifyGlobalObservers({
                type: 'lifecycle',
                eventType: 'statement_completed',
                statementId: engine.statementId,
                result,
                timestamp: Date.now()
            });
            
            return result;
            
        } catch (error: any) {
            // Remove from active statements on error
            this.activeStatements.delete(engine.statementId);
            
            // Notify global observers of error
            this.notifyGlobalObservers({
                type: 'lifecycle',
                eventType: 'statement_error',
                statementId: engine.statementId,
                error: error.message,
                timestamp: Date.now()
            });
            
            throw error;
        }
    }

    // Cancel a specific statement
    async cancelStatement(statementId: string): Promise<{ success: boolean; message: string }> {
        const engine = this.activeStatements.get(statementId);
        if (!engine) {
            log.info(`Statement ${statementId} not found in active statements`);
            return { success: false, message: 'Statement not found' };
        }

        log.info(`Cancelling statement: ${statementId}`);
        
        try {
            // Check if this is a streaming query
            const isStreaming = engine.isStreamingQuery?.() || false;
            
            const result = await engine.cancel();
            
            // For streaming queries, we might want to close the session to fully stop the stream
            if (isStreaming) {
                log.info(`Cancelling a streaming query: ${statementId}`);
                
                // If it's a streaming query, make sure it's fully terminated
                try {
                    if (engine.operationHandle) {
                        const session = this.sessionManager.getSessionInfo();
                        if (session?.sessionHandle) {
                            log.info(`Closing operation handle for streaming query: ${statementId}`);
                            await this.flinkApi.closeOperation(session.sessionHandle, engine.operationHandle);
                        }
                    }
                } catch (closeError: any) {
                    log.warn(`Error while closing streaming operation: ${closeError.message}`);
                }
            }
            
            this.activeStatements.delete(statementId);
            
            // Notify global observers
            this.notifyGlobalObservers({
                type: 'lifecycle',
                eventType: 'statement_cancelled',
                statementId,
                timestamp: Date.now()
            });
            
            return result;
        } catch (error: any) {
            log.error(`Error cancelling statement ${statementId}: ${error.message}`);
            throw error;
        }
    }

    // Cancel all active statements
    async cancelAllStatements(): Promise<Array<{ statementId: string; success: boolean; error?: string }>> {
        log.info(`Cancelling all ${this.activeStatements.size} active statements`);
        
        const cancellationPromises = Array.from(this.activeStatements.entries()).map(async ([statementId, engine]) => {
            try {
                await engine.cancel();
                return { statementId, success: true };
            } catch (error: any) {
                log.error(`Error cancelling statement ${statementId}: ${error.message}`);
                return { statementId, success: false, error: error.message };
            }
        });
        
        const results = await Promise.allSettled(cancellationPromises);
        this.activeStatements.clear();
        
        const finalResults = results.map(r => r.status === 'fulfilled' ? r.value : { statementId: 'unknown', success: false, error: 'Promise rejected' });
        
        // Notify global observers
        this.notifyGlobalObservers({
            type: 'lifecycle',
            eventType: 'all_statements_cancelled',
            timestamp: Date.now()
        });
        
        return finalResults;
    }

    // Get information about a specific statement
    getStatementInfo(statementId: string): any {
        const engine = this.activeStatements.get(statementId);
        return engine ? engine.getState() : null;
    }

    // Get information about all active statements
    getAllActiveStatements(): Record<string, any> {
        const statements: Record<string, any> = {};
        this.activeStatements.forEach((engine, statementId) => {
            statements[statementId] = engine.getState();
        });
        return statements;
    }

    // Add observer to a specific statement
    addStatementObserver(statementId: string, observer: (notification: StatementNotification) => void): boolean {
        const engine = this.activeStatements.get(statementId);
        if (engine) {
            engine.addObserver(observer);
            return true;
        }
        return false;
    }

    // Remove observer from a specific statement
    removeStatementObserver(statementId: string, observer: (notification: StatementNotification) => void): boolean {
        const engine = this.activeStatements.get(statementId);
        if (engine) {
            engine.removeObserver(observer);
            return true;
        }
        return false;
    }

    // Get count of active statements
    getActiveStatementCount(): number {
        return this.activeStatements.size;
    }

    // Check if any statements are running
    hasRunningStatements(): boolean {
        return Array.from(this.activeStatements.values()).some(engine => engine.isRunning());
    }

    // Get only running statements
    getRunningStatements(): Record<string, any> {
        const running: Record<string, any> = {};
        this.activeStatements.forEach((engine, statementId) => {
            if (engine.isRunning()) {
                running[statementId] = engine.getState();
            }
        });
        return running;
    }

    // Legacy compatibility methods for existing code

    // Legacy method - cancel operation (for backward compatibility)  
    async cancelOperation(operationHandle: string): Promise<{ success: boolean; message: string }> {
        // Find statement by operation handle
        for (const [statementId, engine] of Array.from(this.activeStatements.entries())) {
            if (engine.operationHandle === operationHandle) {
                return this.cancelStatement(statementId);
            }
        }
        
        log.info(`Operation handle ${operationHandle} not found in active statements`);
        return { success: false, message: 'Operation not found' };
    }

    // Check if connected
    isConnected(): boolean {
        return this.sessionManager.isConnected();
    }

    // Show output
    showOutput(): void {
        this.outputChannel.show();
    }

    // Dispose resources
    dispose(): void {
        this.globalObservers.clear();
        this.activeStatements.forEach(engine => engine.dispose());
        this.activeStatements.clear();
        this.outputChannel.dispose();
        this.sessionManager.dispose();
    }
}

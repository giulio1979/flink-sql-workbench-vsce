/**
 * FlinkGatewayServiceAdapter - Bridges old provider interfaces with new robust services
 * 
 * This adapter implements the FlinkGatewayService interface that existing providers expect,
 * but internally uses the new robust StatementManager, SessionManager, and FlinkApiService.
 * 
 * This allows us to keep existing provider code unchanged while migrating to the new
 * architecture. Once all providers are updated to use the new services directly,
 * this adapter can be removed.
 */

import * as vscode from 'vscode';
import { StatementManager } from './StatementManager';
import { SessionManager } from './SessionManager';
import { FlinkApiService } from './FlinkApiService';
import { logger, createModuleLogger } from './logger';
import { QueryResult, SessionInfo } from '../types';
import { SimpleConnection } from './SimpleConnection';
import { GlobalSessionState } from './GlobalSessionState';

const log = createModuleLogger('FlinkGatewayServiceAdapter');

export class FlinkGatewayServiceAdapter {
    private statementManager: StatementManager;
    private sessionManager: SessionManager;
    private flinkApi: FlinkApiService;
    private outputChannel: vscode.OutputChannel;
    private globalSessionState: GlobalSessionState;

    // Properties expected by legacy interface
    public config: any = {};
    public sessionHandle: string | null = null;
    public sessionName: string = '';
    public connected: boolean = false;

    constructor(
        statementManager: StatementManager,
        sessionManager: SessionManager,
        flinkApi: FlinkApiService
    ) {
        this.statementManager = statementManager;
        this.sessionManager = sessionManager;
        this.flinkApi = flinkApi;
        this.outputChannel = vscode.window.createOutputChannel('Flink Gateway Adapter');
        this.globalSessionState = GlobalSessionState.getInstance();

        // Listen to session updates from SessionManager
        this.sessionManager.addListener((sessionInfo) => {
            if (sessionInfo) {
                this.sessionHandle = sessionInfo.sessionHandle;
                this.sessionName = sessionInfo.sessionName;
                this.connected = true;
                
                // Update global state
                const typedSessionInfo: SessionInfo = {
                    sessionHandle: sessionInfo.sessionHandle,
                    sessionName: sessionInfo.sessionName,
                    created: sessionInfo.created,
                    properties: sessionInfo.properties,
                    isActive: true
                };
                this.globalSessionState.setActiveSession(typedSessionInfo);
            } else {
                this.sessionHandle = null;
                this.sessionName = '';
                this.connected = false;
                this.globalSessionState.clearActiveSession();
            }
        });
        
        // Listen to global session state changes
        this.globalSessionState.onSessionChanged((sessionInfo) => {
            if (sessionInfo) {
                this.sessionHandle = sessionInfo.sessionHandle;
                this.sessionName = sessionInfo.sessionName;
                this.connected = true;
            } else {
                this.sessionHandle = null;
                this.sessionName = '';
                this.connected = false;
            }
        });
        
        // Listen to connection changes from SimpleConnection
        SimpleConnection.onConnectionChanged(() => {
            // Update the API service when the connection changes
            if (SimpleConnection.isConnected()) {
                const apiService = SimpleConnection.getApiService();
                if (apiService) {
                    this.flinkApi = apiService;
                    this.sessionManager.setFlinkApi(apiService);
                    this.statementManager.setFlinkApi(apiService);
                    this.connected = true;
                    
                    // Add a small delay to ensure the API service is fully set up
                    setTimeout(() => {
                        // Create a session immediately after connection is established
                        this.createNewSession().then(() => {
                            log.info('Session created automatically after connection changed');
                            // Refresh views after successful session creation
                            vscode.commands.executeCommand('flinkSqlWorkbench.refreshSessions');
                            vscode.commands.executeCommand('workbench.actions.refreshTimeline');
                        }).catch(err => {
                            log.error('Failed to create session after connection changed:', err);
                            // Try one more time after a short delay
                            setTimeout(() => {
                                this.createNewSession().catch(error => {
                                    log.error('Second attempt to create session failed:', error);
                                });
                            }, 1000);
                        });
                    }, 500);
                }
            } else {
                this.connected = false;
                this.sessionHandle = null;
                this.sessionName = '';
            }
        });
    }

    /**
     * Check if connected to gateway
     */
    isConnected(): boolean {
        // First check SimpleConnection as the source of truth
        if (SimpleConnection.isConnected()) {
            this.connected = true;
            
            // Check if we have an active session in the global state
            const activeSession = this.globalSessionState.getActiveSession();
            if (activeSession) {
                this.sessionHandle = activeSession.sessionHandle;
                this.sessionName = activeSession.sessionName;
                return true;
            }
            
            // Ensure we have a valid session when connected
            if (!this.sessionHandle) {
                // Trigger session creation asynchronously
                this.validateAndCreateSession();
            }
            
            return true;
        }
        
        // Fall back to own connection status
        return this.connected && this.sessionHandle !== null;
    }
    
    /**
     * Validate current session and create one if needed
     * This helps maintain session state when switching connections
     */
    private async validateAndCreateSession(): Promise<void> {
        try {
            // First check if there's an active session in the global state
            const activeSession = this.globalSessionState.getActiveSession();
            if (activeSession) {
                // Verify it's still valid
                try {
                    const isValid = await this.globalSessionState.validateActiveSession(this.sessionManager);
                    if (isValid) {
                        log.info('Active session in global state is valid');
                        return;
                    }
                } catch (e) {
                    log.warn('Error validating global session', e);
                }
            }
            
            if (!this.sessionHandle) {
                log.info('No session handle found, creating new session');
                await this.createNewSession();
            } else {
                // Verify session is still valid
                try {
                    const sessionInfo = await this.sessionManager.validateSession();
                    if (!sessionInfo) {
                        log.info('Session invalid, creating new session');
                        await this.createNewSession();
                    } else {
                        // Update the global session state
                        await this.globalSessionState.setActiveSessionFromManager(this.sessionManager);
                    }
                } catch (e) {
                    log.warn('Error validating session, creating new one', e);
                    await this.createNewSession();
                }
            }
        } catch (error) {
            log.error('Failed to validate and create session:', error);
        }
    }

    /**
     * Execute a SQL query and return results in legacy format
     */
    async executeQuery(sql: string): Promise<QueryResult | null> {
        try {
            // Add debug logging to see what SQL is being executed
            log.info(`Executing SQL query: ${sql.length > 100 ? sql.substring(0, 100) + '...' : sql}`);
            
            const executionResult = await this.statementManager.executeSQL(sql);
            
            // Log the result details
            log.info(`Query execution result: status=${executionResult.status}, columns=${executionResult.state.columns.length}, results=${executionResult.state.results.length}`);
            
            // Check for streaming query
            const isStreamingQuery = sql.toLowerCase().includes('show') && 
                                    (sql.toLowerCase().includes('databases') || 
                                     sql.toLowerCase().includes('tables') || 
                                     sql.toLowerCase().includes('catalogs'));
            
            if (executionResult.status === 'COMPLETED') {
                // Convert ExecutionResult to QueryResult format
                const queryResult: QueryResult = {
                    columns: executionResult.state.columns.map(col => ({
                        name: col.name,
                        logicalType: {
                            type: col.logicalType.type,
                            nullable: col.logicalType.nullable
                        }
                    })),
                    results: executionResult.state.results,
                    executionTime: executionResult.state.lastUpdateTime || 0,
                    error: executionResult.error,
                    isStreaming: isStreamingQuery
                };
                
                // Debug log to check the results
                if (queryResult.results && queryResult.results.length > 0) {
                    log.info(`Sample result: ${JSON.stringify(queryResult.results[0])}`);
                } else {
                    log.info('Query returned no results');
                }
                
                return queryResult;
            } else {
                // Return error result
                return {
                    columns: [],
                    results: [],
                    executionTime: 0,
                    error: executionResult.error || `Statement failed with status: ${executionResult.status}`,
                    isStreaming: false
                };
            }
        } catch (error: any) {
            logger.error(`Query execution failed: ${error.message}`);
            return {
                columns: [],
                results: [],
                executionTime: 0,
                error: error.message,
                isStreaming: false
            };
        }
    }

    /**
     * Connect to Flink Gateway
     */
    async connect(): Promise<boolean> {
        try {
            const sessionInfo = await this.statementManager.createSession();
            this.connected = true;
            this.sessionHandle = sessionInfo.sessionHandle;
            this.sessionName = sessionInfo.sessionName;
            logger.info(`Connected via adapter: ${sessionInfo.sessionHandle}`);
            return true;
        } catch (error: any) {
            logger.error(`Connection failed via adapter: ${error.message}`);
            this.connected = false;
            return false;
        }
    }

    /**
     * Disconnect from Flink Gateway
     */
    async disconnect(): Promise<void> {
        try {
            await this.sessionManager.closeSession();
            this.connected = false;
            this.sessionHandle = null;
            this.sessionName = '';
            logger.info('Disconnected via adapter');
        } catch (error: any) {
            logger.error(`Disconnect failed via adapter: ${error.message}`);
        }
    }

    /**
     * Get current session info
     */
    async getCurrentSession(): Promise<SessionInfo | null> {
        if (!this.sessionHandle) {
            return null;
        }

        return {
            sessionHandle: this.sessionHandle,
            sessionName: this.sessionName,
            created: new Date(), // We don't track creation time in new services
            isActive: true
        };
    }

    /**
     * Create new session
     */
    async createNewSession(): Promise<boolean> {
        // Ensure we have an API service before attempting to create a session
        if (!this.flinkApi || !SimpleConnection.isConnected()) {
            const apiService = SimpleConnection.getApiService();
            if (!apiService) {
                log.warn('Cannot create session: No active API service available');
                return false;
            }
            this.flinkApi = apiService;
            this.sessionManager.setFlinkApi(apiService);
            this.statementManager.setFlinkApi(apiService);
        }
        
        try {
            // First check if we already have a valid session
            if (this.sessionHandle) {
                try {
                    const isValid = await this.sessionManager.validateSession();
                    if (isValid) {
                        log.info('Existing session is valid, reusing it');
                        return true;
                    }
                } catch (e) {
                    log.warn('Error validating existing session, will create a new one');
                }
            }
            
            const sessionInfo = await this.statementManager.createSession();
            this.connected = true;
            this.sessionHandle = sessionInfo.sessionHandle;
            this.sessionName = sessionInfo.sessionName;
            logger.info(`New session created via adapter: ${sessionInfo.sessionHandle}`);
            return true;
        } catch (error: any) {
            logger.error(`Session creation failed via adapter: ${error.message}`);
            return false;
        }
    }

    /**
     * Delete current session
     */
    async deleteCurrentSession(): Promise<void> {
        await this.disconnect();
    }

    /**
     * Get session details
     */
    async getSessionDetails(): Promise<SessionInfo | null> {
        return this.getCurrentSession();
    }

    /**
     * Show output panel
     */
    showOutput(): void {
        logger.show();
    }

    /**
     * Set session refresh callback (legacy compatibility)
     */
    setSessionRefreshCallback(callback: () => void): void {
        this.sessionManager.addListener(() => {
            callback();
        });
    }

    // Additional methods that might be expected by providers
    get detectedApiVersion(): string {
        return 'v1'; // Default to v1 for compatibility
    }

    async makeRequest(method: string, url: string, data?: any): Promise<any> {
        // Delegate to FlinkApiService
        try {
            return await this.flinkApi.request(url, {
                method,
                body: data ? JSON.stringify(data) : undefined
            });
        } catch (error: any) {
            logger.error(`Request failed via adapter: ${error.message}`);
            throw error;
        }
    }

    // Jobs management methods using SQL commands
    async getJobs(): Promise<any> {
        log.traceEnter('getJobs');
        try {
            const currentSession = await this.getCurrentSession();
            if (!currentSession || !currentSession.sessionHandle) {
                log.warn('getJobs', 'No active session for getting jobs');
                return [];
            }

            const results = await this.flinkApi.getJobsViaSql(currentSession.sessionHandle);
            
            // Check if we have valid results
            if (!results || !results.results || !Array.isArray(results.results)) {
                log.warn('getJobs', 'No valid results returned from SHOW JOBS query');
                return [];
            }
            
            log.info('getJobs', `Processing ${results.results.length} job rows`);
            
            // Transform the SQL results to job objects
            // The actual data structure has each result as: { kind: "INSERT", fields: [job_id, job_name, status, start_time] }
            const jobs = results.results.map((result: any, index: number) => {
                // Extract fields array from the result object
                const fields = result.fields || [];
                
                // Map to expected positions: [job_id, job_name, status, start_time]
                const jobId = (fields[0] && fields[0] !== '') ? fields[0] : `unknown-job-${index}-${Date.now()}`;
                const rawJobName = fields[1] || `Unknown Job ${index + 1}`;
                const jobStatus = fields[2] || 'UNKNOWN';
                const startTime = fields[3] || 0;
                
                // Create a more user-friendly job name from the SQL query
                let displayName = rawJobName;
                if (rawJobName.includes('SELECT') && rawJobName.includes('FROM')) {
                    // Extract table name from SQL query for a cleaner display
                    const tableMatch = rawJobName.match(/FROM\s+`?([^`\s]+)`?\.`?([^`\s]+)`?\.`?([^`\s]+)`?/i);
                    if (tableMatch) {
                        const tableName = tableMatch[3] || tableMatch[2] || tableMatch[1];
                        displayName = `Query on ${tableName}`;
                    } else {
                        displayName = `SQL Query ${jobId.substring(0, 8)}...`;
                    }
                }
                
                const jobObj = {
                    jid: jobId,
                    name: displayName,
                    state: jobStatus,
                    'start-time': startTime
                };
                
                log.info('getJobs', `Transformed job ${index}: ${JSON.stringify(jobObj)}`);
                return jobObj;
            });

            log.traceExit('getJobs', { jobCount: jobs.length });
            return jobs;
        } catch (error: any) {
            log.error('getJobs', `Failed to get jobs: ${error.message}`);
            // Return empty array on error to prevent crashes
            return [];
        }
    }

    async stopJob(jobId: string): Promise<any> {
        log.traceEnter('stopJob', { jobId });
        try {
            const currentSession = await this.getCurrentSession();
            if (!currentSession || !currentSession.sessionHandle) {
                throw new Error('No active session for stopping job');
            }

            const response = await this.flinkApi.stopJobViaSql(currentSession.sessionHandle, jobId);
            log.traceExit('stopJob', response);
            return response;
        } catch (error: any) {
            log.error('stopJob', `Failed to stop job ${jobId}: ${error.message}`);
            throw error;
        }
    }

    async cancelJob(jobId: string): Promise<any> {
        log.traceEnter('cancelJob', { jobId });
        try {
            // For cancel, we might need to use a different SQL command or similar approach
            // Some Flink versions support CANCEL JOB, others might need different approaches
            const currentSession = await this.getCurrentSession();
            if (!currentSession || !currentSession.sessionHandle) {
                throw new Error('No active session for cancelling job');
            }

            // Try CANCEL JOB first, fall back to STOP JOB if not supported
            try {
                const submitResponse = await this.flinkApi.submitStatement(currentSession.sessionHandle, `CANCEL JOB '${jobId}'`);
                const operationHandle = submitResponse.operationHandle;
                const results = await this.flinkApi.getAllResults(currentSession.sessionHandle, operationHandle);
                log.traceExit('cancelJob', results);
                return results;
            } catch (cancelError: any) {
                log.warn('cancelJob', `CANCEL JOB not supported, falling back to STOP JOB: ${cancelError.message}`);
                return await this.stopJob(jobId);
            }
        } catch (error: any) {
            log.error('cancelJob', `Failed to cancel job ${jobId}: ${error.message}`);
            throw error;
        }
    }
}

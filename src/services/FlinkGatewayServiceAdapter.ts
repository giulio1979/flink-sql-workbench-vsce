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
import { logger } from './logger';
import { QueryResult, SessionInfo } from '../types';

export class FlinkGatewayServiceAdapter {
    private statementManager: StatementManager;
    private sessionManager: SessionManager;
    private flinkApi: FlinkApiService;
    private outputChannel: vscode.OutputChannel;

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

        // Listen to session updates
        this.sessionManager.addListener((sessionInfo) => {
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
    }

    /**
     * Check if connected to gateway
     */
    isConnected(): boolean {
        return this.connected && this.sessionHandle !== null;
    }

    /**
     * Execute a SQL query and return results in legacy format
     */
    async executeQuery(sql: string): Promise<QueryResult | null> {
        try {
            const executionResult = await this.statementManager.executeSQL(sql);
            
            if (executionResult.status === 'COMPLETED') {
                // Convert ExecutionResult to QueryResult format
                return {
                    columns: executionResult.state.columns.map(col => ({
                        name: col.name,
                        logicalType: {
                            type: col.logicalType.type,
                            nullable: col.logicalType.nullable
                        }
                    })),
                    results: executionResult.state.results,
                    executionTime: executionResult.state.lastUpdateTime || 0,
                    error: executionResult.error
                };
            } else {
                // Return error result
                return {
                    columns: [],
                    results: [],
                    executionTime: 0,
                    error: executionResult.error || `Statement failed with status: ${executionResult.status}`
                };
            }
        } catch (error: any) {
            logger.error(`Query execution failed: ${error.message}`);
            return {
                columns: [],
                results: [],
                executionTime: 0,
                error: error.message
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
            created: new Date() // We don't track creation time in new services
        };
    }

    /**
     * Create new session
     */
    async createNewSession(): Promise<boolean> {
        try {
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
}

import * as vscode from 'vscode';
import { FlinkApiService } from './FlinkApiService';
import { createModuleLogger } from './logger';

const log = createModuleLogger('SessionManager');

export interface SessionInfo {
    sessionHandle: string;
    sessionName: string;
    created: Date;
    properties: Record<string, string>;
}

/**
 * SessionManager - Manages Flink session lifecycle (Singleton)
 * Handles session creation, validation, and cleanup
 * Shared across all statement executions
 */
export class SessionManager {
    private static instance: SessionManager | null = null;
    
    private flinkApi: FlinkApiService;
    private currentSession: SessionInfo | null = null;
    private sessionStartTime: number | null = null;
    private sessionProperties: Record<string, string> = {
        'sql-gateway.session.idle-timeout': '30min',
        'sql-gateway.session.check-interval': '1min'
    };
    private listeners = new Set<(sessionInfo: SessionInfo | null) => void>();
    private outputChannel: vscode.OutputChannel;

    private constructor(flinkApi: FlinkApiService) {
        log.traceEnter('constructor');
        
        this.flinkApi = flinkApi;
        this.outputChannel = vscode.window.createOutputChannel('Flink Session Manager');
        this.loadSessionProperties();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('flinkSqlWorkbench.session')) {
                this.loadSessionProperties();
            }
        });
        
        log.traceExit('constructor');
    }
    
    // Static method to get singleton instance
    static getInstance(flinkApi: FlinkApiService): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager(flinkApi);
        }
        return SessionManager.instance;
    }

    private loadSessionProperties(): void {
        const sessionConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.session');
        
        this.sessionProperties = sessionConfig.get<Record<string, string>>('properties', {
            'execution.runtime-mode': 'streaming',
            'table.exec.resource.default-parallelism': '1',
            'execution.checkpointing.interval': '10s',
            'sql-gateway.session.idle-timeout': '30min',
            'sql-gateway.session.check-interval': '1min'
        });
        
        log.info(`Session properties loaded: ${JSON.stringify(this.sessionProperties)}`);
    }

    // Add listener for session changes
    addListener(callback: (sessionInfo: SessionInfo | null) => void): void {
        this.listeners.add(callback);
    }

    // Remove listener
    removeListener(callback: (sessionInfo: SessionInfo | null) => void): void {
        this.listeners.delete(callback);
    }

    // Notify all listeners of session changes
    private notifyListeners(): void {
        this.listeners.forEach(callback => {
            try {
                callback(this.getSessionInfo());
            } catch (error: any) {
                log.error(`Error in session listener: ${error.message}`);
            }
        });
    }

    // Get current session information
    getSessionInfo(): SessionInfo | null {
        log.trace('Getting session info');
        
        if (!this.currentSession) {
            return null;
        }

        return {
            ...this.currentSession,
            created: new Date(this.sessionStartTime || Date.now())
        };
    }

    // Update session properties (for UI configuration)
    updateSessionProperties(newProperties: Record<string, string>): void {
        log.traceEnter('updateSessionProperties', { newProperties });
        log.info(`Updating session properties: ${JSON.stringify(newProperties, null, 2)}`);
        
        this.sessionProperties = { ...newProperties };
        this.notifyListeners();
        
        log.traceExit('updateSessionProperties');
    }

    // Create a new session
    async createSession(customProperties: Record<string, string> = {}): Promise<SessionInfo> {
        log.traceEnter('createSession', { customProperties });
        log.info('Creating new Flink session...');
        
        try {
            const properties = {
                ...this.sessionProperties,
                ...customProperties
            };

            log.info(`Session properties: ${JSON.stringify(properties, null, 2)}`);
            
            const response = await this.flinkApi.createSession(properties);
            
            this.currentSession = {
                sessionHandle: response.sessionHandle,
                sessionName: this.getSessionName(),
                created: new Date(),
                properties: properties
            };
            
            this.sessionStartTime = Date.now();
            
            log.info(`Session created: ${response.sessionHandle}`);
            
            this.notifyListeners();
            return this.currentSession;
            
        } catch (error: any) {
            log.error(`Failed to create session: ${error.message}`);
            this.currentSession = null;
            this.sessionStartTime = null;
            this.notifyListeners();
            throw error;
        }
    }

    // Get or create a session
    async getSession(): Promise<SessionInfo> {
        if (!this.currentSession) {
            log.info('No active session, creating new one...');
            await this.createSession();
        } else {
            log.info(`Reusing existing session: ${this.currentSession.sessionHandle}`);
        }
        
        return this.currentSession!;
    }

    // Validate if current session is still active
    async validateSession(): Promise<boolean> {
        if (!this.currentSession) {
            return false;
        }

        try {
            log.info(`Validating session: ${this.currentSession.sessionHandle}`);
            await this.flinkApi.getSession(this.currentSession.sessionHandle);
            log.info('Session is valid');
            return true;
        } catch (error: any) {
            log.warn(`Session validation failed: ${error.message}`);
            this.currentSession = null;
            this.sessionStartTime = null;
            this.notifyListeners();
            return false;
        }
    }

    // Close current session
    async closeSession(): Promise<void> {
        if (!this.currentSession) {
            log.info('No active session to close');
            return;
        }

        try {
            log.info(`Closing session: ${this.currentSession.sessionHandle}`);
            await this.flinkApi.closeSession(this.currentSession.sessionHandle);
            log.info('Session closed successfully');
        } catch (error: any) {
            log.warn(`Error closing session: ${error.message}`);
        } finally {
            this.currentSession = null;
            this.sessionStartTime = null;
            this.notifyListeners();
        }
    }

    // Refresh session (close and create new)
    async refreshSession(): Promise<SessionInfo> {
        log.info('Refreshing session...');
        await this.closeSession();
        return await this.createSession();
    }

    // Get session age in human readable format
    getSessionAge(): string {
        if (!this.sessionStartTime) return 'No active session';
        
        const ageMs = Date.now() - this.sessionStartTime;
        const ageMinutes = Math.floor(ageMs / 60000);
        const ageSeconds = Math.floor((ageMs % 60000) / 1000);
        
        if (ageMinutes > 0) {
            return `${ageMinutes}m ${ageSeconds}s`;
        } else {
            return `${ageSeconds}s`;
        }
    }

    // Get session name from configuration
    private getSessionName(): string {
        const sessionConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.session');
        return sessionConfig.get<string>('sessionName', 'vscode-session');
    }

    // Check if currently connected to a session
    isConnected(): boolean {
        return this.currentSession !== null;
    }

    // Get current session handle
    getCurrentSessionHandle(): string | null {
        return this.currentSession?.sessionHandle || null;
    }

    // Show output channel
    showOutput(): void {
        this.outputChannel.show();
    }

    // Dispose resources
    dispose(): void {
        this.listeners.clear();
        this.outputChannel.dispose();
    }
}

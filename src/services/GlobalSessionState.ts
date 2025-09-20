import * as vscode from 'vscode';
import { SessionManager, SessionInfo as ManagerSessionInfo } from './SessionManager';
import { SimpleConnection } from './SimpleConnection';
import { SessionInfo as TypesSessionInfo } from '../types';
import { createModuleLogger } from './logger';

const log = createModuleLogger('GlobalSessionState');

/**
 * GlobalSessionState - Singleton service to maintain global session state
 * This allows tracking the currently active session across the application
 */
export class GlobalSessionState {
    private static instance: GlobalSessionState | null = null;
    private activeSession: TypesSessionInfo | null = null;
    private _onSessionChanged = new vscode.EventEmitter<TypesSessionInfo | null>();
    readonly onSessionChanged = this._onSessionChanged.event;

    private constructor() {
        log.info('GlobalSessionState initialized');
    }

    static getInstance(): GlobalSessionState {
        if (!GlobalSessionState.instance) {
            GlobalSessionState.instance = new GlobalSessionState();
        }
        return GlobalSessionState.instance;
    }

    /**
     * Get the currently active session
     */
    getActiveSession(): TypesSessionInfo | null {
        // Add validation to ensure we have a valid session with required properties
        if (this.activeSession && (!this.activeSession.sessionHandle || !this.activeSession.sessionName)) {
            log.warn('Found invalid session in global state, clearing it');
            this.setActiveSession(null);
            return null;
        }
        return this.activeSession;
    }

    /**
     * Set the currently active session
     */
    setActiveSession(session: TypesSessionInfo | null): void {
        log.info(`Setting active session: ${session?.sessionHandle || 'null'}`);
        this.activeSession = session;
        this._onSessionChanged.fire(session);

        // Set VS Code context variable for UI state
        vscode.commands.executeCommand('setContext', 'hasActiveSession', !!session);
    }

    /**
     * Check if a session is active
     */
    hasActiveSession(): boolean {
        return this.activeSession !== null;
    }

    /**
     * Convert from SessionManager SessionInfo to our TypesSessionInfo
     */
    private convertSessionInfo(sessionInfo: ManagerSessionInfo): TypesSessionInfo {
        return {
            sessionHandle: sessionInfo.sessionHandle,
            sessionName: sessionInfo.sessionName,
            created: sessionInfo.created,
            properties: sessionInfo.properties,
            isActive: true
        };
    }
    
    /**
     * Validate the current session and return true if valid
     */
    async validateActiveSession(sessionManager: SessionManager): Promise<boolean> {
        if (!this.activeSession) {
            return false;
        }

        try {
            const sessionValid = await sessionManager.validateSession();
            if (!sessionValid) {
                this.activeSession = null;
                this._onSessionChanged.fire(null);
                return false;
            }
            
            // Update the active session with latest info
            const sessionInfo = sessionManager.getSessionInfo();
            if (sessionInfo) {
                const convertedInfo = this.convertSessionInfo(sessionInfo);
                this.activeSession = convertedInfo;
                this._onSessionChanged.fire(convertedInfo);
            }
            
            return true;
        } catch (error: any) {
            log.error(`Error validating session: ${error?.message || 'Unknown error'}`);
            this.activeSession = null;
            this._onSessionChanged.fire(null);
            return false;
        }
    }

    /**
     * Clear the active session
     */
    clearActiveSession(): void {
        log.info('Clearing active session');
        this.activeSession = null;
        this._onSessionChanged.fire(null);
        vscode.commands.executeCommand('setContext', 'hasActiveSession', false);
    }

    /**
     * Automatically set the active session from the session manager
     * Used when creating a new session or when no active session exists
     */
    async setActiveSessionFromManager(sessionManager: SessionManager): Promise<boolean> {
        try {
            const sessionInfo = sessionManager.getSessionInfo();
            if (sessionInfo) {
                const convertedInfo = this.convertSessionInfo(sessionInfo);
                this.setActiveSession(convertedInfo);
                return true;
            } else {
                // Try to create a new session if one doesn't exist
                if (SimpleConnection.isConnected()) {
                    try {
                        const newSession = await sessionManager.createSession();
                        const convertedSession = this.convertSessionInfo(newSession);
                        this.setActiveSession(convertedSession);
                        return true;
                    } catch (error: any) {
                        log.error(`Failed to create new session: ${error?.message || 'Unknown error'}`);
                        return false;
                    }
                }
            }
            return false;
        } catch (error: any) {
            log.error(`Error setting active session from manager: ${error?.message || 'Unknown error'}`);
            return false;
        }
    }
}
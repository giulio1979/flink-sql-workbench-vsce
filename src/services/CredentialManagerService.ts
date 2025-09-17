import * as vscode from 'vscode';
import { GatewayCredentials } from './FlinkApiService';
import { createModuleLogger } from './logger';

const log = createModuleLogger('CredentialManagerService');

export interface CredentialConnection {
    id: string;
    name: string;
    type: string;
    url: string;
    authType: string;
    username?: string;
    password?: string;
    apiToken?: string;
}

/**
 * CredentialManagerService - Integrates with external credential manager extension
 * Retrieves connection details and credentials from the credential manager
 */
export class CredentialManagerService {
    private static extensionContext: vscode.ExtensionContext | null = null;
    
    /**
     * Initialize the service with extension context
     */
    static initialize(context: vscode.ExtensionContext): void {
        this.extensionContext = context;
    }
    
    /**
     * Get connection details from credential manager by connection ID
     */
    static async getConnectionById(connectionId: string): Promise<CredentialConnection | null> {
        log.traceEnter('getConnectionById', { connectionId });
        
        try {
            // Get the credential manager connections from workspace configuration
            const config = vscode.workspace.getConfiguration();
            const connections = config.get<CredentialConnection[]>('credentialManager.connections', []);
            
            log.info(`Found ${connections.length} connections in credential manager`);
            
            const connection = connections.find(conn => conn.id === connectionId);
            
            if (!connection) {
                log.warn(`Connection with ID ${connectionId} not found in credential manager`);
                log.traceExit('getConnectionById', null);
                return null;
            }
            
            log.info(`Found connection: ${connection.name} (${connection.type})`);
            
            // For connections with stored passwords, we need to retrieve them from the secrets storage
            let fullConnection = { ...connection };
            
            if (connection.authType === 'basic' && connection.username && !connection.password) {
                // Try to get password from VS Code secrets storage
                try {
                    if (this.extensionContext) {
                        const secretKey = `credentialManager.${connectionId}.password`;
                        const password = await this.extensionContext.secrets.get(secretKey);
                        if (password) {
                            fullConnection.password = password;
                            log.info('Retrieved password from secrets storage');
                        } else {
                            log.warn('Password not found in secrets storage');
                        }
                    } else {
                        log.warn('Extension context not available for secrets access');
                    }
                } catch (error: any) {
                    log.warn(`Failed to retrieve password from secrets: ${error.message}`);
                }
            }
            
            log.traceExit('getConnectionById', fullConnection);
            return fullConnection;
            
        } catch (error: any) {
            log.error(`Failed to get connection: ${error.message}`);
            log.traceExit('getConnectionById', null);
            return null;
        }
    }
    
    /**
     * Convert credential manager connection to FlinkApi credentials
     */
    static connectionToCredentials(connection: CredentialConnection): GatewayCredentials {
        log.traceEnter('connectionToCredentials', { connectionId: connection.id });
        
        const credentials: GatewayCredentials = {};
        
        if (connection.authType === 'basic') {
            credentials.username = connection.username;
            credentials.password = connection.password;
        } else if (connection.authType === 'bearer' || connection.authType === 'token') {
            credentials.apiToken = connection.apiToken;
        }
        
        log.info(`Converted credentials for auth type: ${connection.authType}`);
        log.traceExit('connectionToCredentials', { hasUsername: !!credentials.username, hasPassword: !!credentials.password, hasToken: !!credentials.apiToken });
        
        return credentials;
    }
    
    /**
     * Get credentials for a connection ID
     */
    static async getCredentialsById(connectionId: string): Promise<GatewayCredentials | null> {
        log.traceEnter('getCredentialsById', { connectionId });
        
        const connection = await this.getConnectionById(connectionId);
        if (!connection) {
            log.traceExit('getCredentialsById', null);
            return null;
        }
        
        const credentials = this.connectionToCredentials(connection);
        log.traceExit('getCredentialsById', credentials);
        return credentials;
    }
    
    /**
     * Get connection URL by connection ID
     */
    static async getConnectionUrl(connectionId: string): Promise<string | null> {
        log.traceEnter('getConnectionUrl', { connectionId });
        
        const connection = await this.getConnectionById(connectionId);
        const url = connection?.url || null;
        
        log.traceExit('getConnectionUrl', { url });
        return url;
    }
}
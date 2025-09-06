import * as vscode from 'vscode';
import { createModuleLogger } from './logger';

const log = createModuleLogger('CredentialService');

export interface ConnectionMeta {
    id: string;
    name: string;
    url: string;
    type: 'connect' | 'schema-registry' | 'flink-gateway';
    authType: 'none' | 'basic' | 'bearer';
    username?: string;
}

export interface FlinkConnection {
    id: string;
    name: string;
    url: string;
    headers?: Record<string, string>;
}

/**
 * Service to interact with the Credential Manager extension
 */
export class CredentialService {
    private static instance: CredentialService;

    private constructor() {}

    public static getInstance(): CredentialService {
        if (!CredentialService.instance) {
            CredentialService.instance = new CredentialService();
        }
        return CredentialService.instance;
    }

    /**
     * Check if the Credential Manager extension is available
     */
    public isCredentialManagerAvailable(): boolean {
        const extension = vscode.extensions.getExtension('IuliusHutuleac.credential-manager');
        return extension !== undefined && extension.isActive;
    }

    /**
     * Get all available connections from the Credential Manager
     */
    public async getConnections(): Promise<ConnectionMeta[]> {
        try {
            const config = vscode.workspace.getConfiguration();
            const connections = config.get<ConnectionMeta[]>('credentialManager.connections', []);
            
            log.info(`Found ${connections.length} total connections in Credential Manager`);
            connections.forEach(conn => {
                log.info(`Connection: ${conn.name} (${conn.id}) - Type: ${conn.type}, URL: ${conn.url}`);
            });
            
            // Filter for Flink Gateway connections only
            const flinkConnections = connections.filter(conn => 
                conn.type === 'flink-gateway'
            );
            
            log.info(`Filtered to ${flinkConnections.length} Flink Gateway connections`);
            return flinkConnections;
        } catch (error) {
            log.error('Failed to get connections from Credential Manager:', error);
            return [];
        }
    }

    /**
     * Get connection details by ID including credentials
     */
    public async getConnectionById(connectionId: string): Promise<FlinkConnection | null> {
        try {
            const connections = await this.getConnections();
            const connection = connections.find(conn => conn.id === connectionId);
            
            if (!connection) {
                log.warn(`Connection with ID ${connectionId} not found`);
                return null;
            }

            // Get the secret from VS Code's secure storage
            const secret = await vscode.workspace.getConfiguration()
                .get(`credentialManager.secret.${connection.id}`);

            // Build auth headers
            const headers: Record<string, string> = {};
            
            if (connection.authType === 'basic' && connection.username && secret) {
                headers['Authorization'] = 'Basic ' + 
                    Buffer.from(connection.username + ':' + secret).toString('base64');
            } else if (connection.authType === 'bearer' && secret) {
                headers['Authorization'] = `Bearer ${secret}`;
            }

            return {
                id: connection.id,
                name: connection.name,
                url: connection.url,
                headers: Object.keys(headers).length > 0 ? headers : undefined
            };
        } catch (error) {
            log.error(`Failed to get connection ${connectionId}:`, error);
            return null;
        }
    }

    /**
     * Open the Credential Manager for managing connections
     */
    public async openCredentialManager(): Promise<void> {
        try {
            if (!this.isCredentialManagerAvailable()) {
                const result = await vscode.window.showWarningMessage(
                    'Credential Manager extension is not installed or not activated. Would you like to install it?',
                    'Install'
                );
                
                if (result === 'Install') {
                    await vscode.commands.executeCommand('workbench.extensions.installExtension', 
                        'IuliusHutuleac.credential-manager');
                }
                return;
            }

            await vscode.commands.executeCommand('credentialManager.openConnectionManager');
        } catch (error) {
            log.error('Failed to open Credential Manager:', error);
            vscode.window.showErrorMessage('Failed to open Credential Manager');
        }
    }

    /**
     * Get the currently configured connection from settings
     */
    public getCurrentConnectionId(): string | undefined {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
        return config.get<string>('connectionId');
    }

    /**
     * Set the current connection ID in settings
     */
    public async setCurrentConnectionId(connectionId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
        await config.update('connectionId', connectionId, vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Get the current connection details including credentials
     */
    public async getCurrentConnection(): Promise<FlinkConnection | null> {
        const connectionId = this.getCurrentConnectionId();
        if (!connectionId) {
            return null;
        }
        
        return this.getConnectionById(connectionId);
    }

    /**
     * Listen for changes in credential manager connections
     */
    public onConnectionsChanged(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('credentialManager.connections') ||
                event.affectsConfiguration('flinkSqlWorkbench.gateway.connectionId')) {
                callback();
            }
        });
    }
}

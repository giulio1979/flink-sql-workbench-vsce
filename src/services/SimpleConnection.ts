import * as vscode from 'vscode';
import { FlinkApiService } from '../services/FlinkApiService';
import { CredentialManagerService } from '../services/CredentialManagerService';

/**
 * Simple global connection state - no overcomplicated managers needed
 */
export class SimpleConnection {
    private static apiService: FlinkApiService | null = null;
    private static currentConnectionName: string = 'Not Connected';
    private static onConnectionChangedEmitter = new vscode.EventEmitter<void>();
    
    public static readonly onConnectionChanged = SimpleConnection.onConnectionChangedEmitter.event;

    /**
     * Get the current API service if connected
     */
    static getApiService(): FlinkApiService | null {
        return SimpleConnection.apiService;
    }

    /**
     * Check if connected
     */
    static isConnected(): boolean {
        return SimpleConnection.apiService !== null;
    }

    /**
     * Get connection name for display
     */
    static getConnectionName(): string {
        return SimpleConnection.currentConnectionName;
    }

    /**
     * Connect to gateway using connection ID (uses credentials from credential manager)
     */
    static async connect(connectionId: string, name: string, url: string, useProxy: boolean = false): Promise<boolean> {
        try {
            // Disconnect first if already connected
            SimpleConnection.disconnect();

            // Create API service
            const apiService = new FlinkApiService(useProxy ? '/api/flink' : url);
            
            // Try to get credentials from credential manager for real connections
            if (connectionId !== 'local' && connectionId !== 'proxy') {
                const credentials = await CredentialManagerService.getCredentialsById(connectionId);
                if (credentials) {
                    apiService.setCredentials(credentials.username, credentials.password, credentials.apiToken);
                }
            }
            
            // Test connection
            await apiService.request('/v1/info');
            
            // Success - store it
            SimpleConnection.apiService = apiService;
            SimpleConnection.currentConnectionName = name;
            
            // Wait a short delay to let listeners attach before firing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Notify listeners
            SimpleConnection.onConnectionChangedEmitter.fire();
            
            vscode.window.showInformationMessage(`Connected to ${name}`);
            return true;
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to connect to ${name}: ${error}`);
            return false;
        }
    }

    /**
     * Disconnect from gateway
     */
    static disconnect(): void {
        SimpleConnection.apiService = null;
        SimpleConnection.currentConnectionName = 'Not Connected';
        SimpleConnection.onConnectionChangedEmitter.fire();
    }

    /**
     * Get predefined connections from credential manager
     */
    static getAvailableConnections(): Array<{id: string, name: string, url: string, useProxy: boolean}> {
        try {
            const connections = CredentialManagerService.getAllConnections();
            
            // Convert CredentialConnection[] to the format expected by the UI
            const availableConnections = connections.map(conn => ({
                id: conn.id,
                name: conn.name,
                url: conn.url,
                useProxy: false // Credential manager connections don't use proxy by default
            }));
            
            // Add defaults if no connections from credential manager
            if (availableConnections.length === 0) {
                return [
                    { id: 'local', name: 'Local Gateway', url: 'http://localhost:8083', useProxy: false },
                    { id: 'proxy', name: 'Gateway (Proxy)', url: '/api/flink', useProxy: true }
                ];
            }
            
            return availableConnections;
        } catch (error) {
            console.error('Failed to get connections from credential manager:', error);
            // Fallback to default connections
            return [
                { id: 'local', name: 'Local Gateway', url: 'http://localhost:8083', useProxy: false },
                { id: 'proxy', name: 'Gateway (Proxy)', url: '/api/flink', useProxy: true }
            ];
        }
    }
}
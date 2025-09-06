import * as vscode from 'vscode';
import { CredentialService, ConnectionMeta } from '../services/CredentialService';
import { createModuleLogger } from '../services/logger';

const log = createModuleLogger('ConnectionSelectorProvider');

export class ConnectionSelectorProvider implements vscode.TreeDataProvider<ConnectionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConnectionItem | undefined | null | void> = new vscode.EventEmitter<ConnectionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConnectionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private credentialService: CredentialService;
    private connections: ConnectionMeta[] = [];
    private currentConnectionId: string | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.credentialService = CredentialService.getInstance();
        this.loadConnections();
        this.loadCurrentConnection();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('credentialManager.connections') || 
                event.affectsConfiguration('flinkSqlWorkbench.gateway.connectionId')) {
                this.refresh();
            }
        });
    }

    private async loadConnections(): Promise<void> {
        try {
            this.connections = await this.credentialService.getConnections();
            log.info(`Loaded ${this.connections.length} Flink Gateway connections from Credential Manager`);
            
            // Debug: show all connections
            this.connections.forEach(conn => {
                log.info(`Available Flink connection: ${conn.name} (${conn.type}) at ${conn.url}`);
            });
            
            if (this.connections.length === 0) {
                log.warn('No Flink Gateway connections found. Make sure to create connections with type "flink-gateway" in the Credential Manager.');
            }
        } catch (error) {
            log.error('Failed to load connections:', error);
            this.connections = [];
        }
    }

    private loadCurrentConnection(): void {
        this.currentConnectionId = this.credentialService.getCurrentConnectionId();
        log.info(`Current connection ID: ${this.currentConnectionId || 'none'}`);
    }

    public async refresh(): Promise<void> {
        await this.loadConnections();
        this.loadCurrentConnection();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConnectionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConnectionItem): Promise<ConnectionItem[]> {
        if (!element) {
            // Root level - show all connections
            const items: ConnectionItem[] = [];

            // Add "No Connection" option
            const noConnectionItem = new ConnectionItem(
                'No Connection',
                'none',
                '',
                'No connection selected - configure connections in Credential Manager',
                vscode.TreeItemCollapsibleState.None,
                this.currentConnectionId === undefined || this.currentConnectionId === ''
            );
            noConnectionItem.command = {
                command: 'flink-sql-workbench.selectConnection',
                title: 'Select Connection',
                arguments: [{ connectionId: '' }]
            };
            items.push(noConnectionItem);

            // Add available connections
            for (const connection of this.connections) {
                const isSelected = this.currentConnectionId === connection.id;
                const item = new ConnectionItem(
                    connection.name,
                    connection.id,
                    connection.url,
                    connection.authType === 'none' ? 'No authentication' : `Authentication: ${connection.authType}`,
                    vscode.TreeItemCollapsibleState.None,
                    isSelected
                );
                item.command = {
                    command: 'flink-sql-workbench.selectConnection',
                    title: 'Select Connection',
                    arguments: [{ connectionId: connection.id }]
                };
                items.push(item);
            }

            return items;
        }

        return [];
    }

    public async selectConnection(connectionId: string): Promise<void> {
        try {
            if (connectionId === '') {
                // Clear connection selection
                await this.credentialService.setCurrentConnectionId('');
                vscode.window.showInformationMessage('Connection cleared. Using fallback configuration.');
            } else {
                // Set selected connection
                await this.credentialService.setCurrentConnectionId(connectionId);
                const connection = this.connections.find(c => c.id === connectionId);
                vscode.window.showInformationMessage(`Selected connection: ${connection?.name || connectionId}`);
            }

            // Refresh the view
            await this.refresh();

        } catch (error) {
            log.error('Failed to select connection:', error);
            vscode.window.showErrorMessage(`Failed to select connection: ${error}`);
        }
    }

    public async openCredentialManager(): Promise<void> {
        await this.credentialService.openCredentialManager();
        // Refresh after user potentially adds/modifies connections
        setTimeout(() => this.refresh(), 1000);
    }

    public async testConnection(connectionId: string): Promise<void> {
        try {
            if (connectionId === '') {
                vscode.window.showWarningMessage('Cannot test connection: No connection selected');
                return;
            }

            const connection = await this.credentialService.getConnectionById(connectionId);
            if (!connection) {
                vscode.window.showErrorMessage(`Connection not found: ${connectionId}`);
                return;
            }

            // Use the test connection logic from SettingsWebviewProvider
            const { FlinkApiService, SessionManager } = require('../services');
            const flinkApi = new FlinkApiService();
            
            flinkApi.setBaseUrl(connection.url);
            
            // Set credentials if available
            if (connection.headers?.['Authorization']) {
                const authHeader = connection.headers['Authorization'];
                if (authHeader.startsWith('Basic ')) {
                    const base64Credentials = authHeader.replace('Basic ', '');
                    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
                    const [username, password] = credentials.split(':');
                    flinkApi.setCredentials(username, password);
                } else if (authHeader.startsWith('Bearer ')) {
                    const token = authHeader.replace('Bearer ', '');
                    flinkApi.setCredentials(undefined, undefined, token);
                }
            }

            // Test connection by creating a session
            const sessionManager = SessionManager.getInstance(flinkApi);
            const sessionInfo = await sessionManager.createSession();
            
            vscode.window.showInformationMessage(`✅ Connection test successful! Session: ${sessionInfo.sessionHandle}`);
            
            // Clean up test session
            await sessionManager.closeSession();

        } catch (error) {
            log.error('Connection test failed:', error);
            vscode.window.showErrorMessage(`❌ Connection test failed: ${error}`);
        }
    }

    public getConnections(): ConnectionMeta[] {
        return this.connections;
    }

    public getCurrentConnectionId(): string | undefined {
        return this.currentConnectionId;
    }
}

class ConnectionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly connectionId: string,
        public readonly url: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isSelected: boolean
    ) {
        super(label, collapsibleState);

        this.tooltip = `${this.label}\nURL: ${this.url}\n${this.description}`;
        this.description = isSelected ? '✓ Selected' : this.description;
        
        // Set icon based on selection and connection type
        if (isSelected) {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else if (connectionId === 'none') {
            this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange'));
        } else {
            this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.blue'));
        }

        this.contextValue = connectionId === 'none' ? 'noConnection' : 'connection';
    }
}

export { ConnectionItem };

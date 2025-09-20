import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';
import { SessionInfo, BaseTreeItem } from '../types';
import { BaseTreeDataProvider, NotificationService, VSCodeUtils, ErrorHandler } from '../utils/base';
import { GlobalSessionState } from '../services/GlobalSessionState';

interface SessionItem extends BaseTreeItem {
    sessionHandle: string;
    isActive: boolean;
    created: Date;
}

export class SessionsProvider extends BaseTreeDataProvider<SessionItem> {
    private currentSession: SessionInfo | null = null;
    private globalSessionState: GlobalSessionState;

    constructor(
        private readonly gatewayService: FlinkGatewayServiceAdapter,
        context: vscode.ExtensionContext
    ) {
        super(context);
        
        // Get GlobalSessionState instance
        this.globalSessionState = GlobalSessionState.getInstance();
        
        // Subscribe to GlobalSessionState changes
        this.globalSessionState.onSessionChanged(sessionInfo => {
            this.currentSession = sessionInfo;
            this.refresh();
        });
        
        // Subscribe to SimpleConnection changes to ensure we refresh when connection changes
        const SimpleConnection = require('../services/SimpleConnection').SimpleConnection;
        SimpleConnection.onConnectionChanged(() => {
            this.refresh();
        });
        
        this.refresh();
    }

    async loadData(): Promise<void> {
        await ErrorHandler.withErrorHandling(async () => {
            // First check if there's an active session in the global state
            const globalSession = this.globalSessionState.getActiveSession();
            if (globalSession) {
                this.currentSession = globalSession;
                
                // Update VS Code context
                await VSCodeUtils.setContext('flinkGatewayConnected', true);
                await VSCodeUtils.setContext('hasActiveSession', true);
                await VSCodeUtils.setContext('workspaceHasFlinkSqlFiles', true);
                return;
            }
            
            // Fall back to gateway service if global state has no session
            if (this.gatewayService.isConnected()) {
                this.currentSession = await this.gatewayService.getCurrentSession();
                
                // If we got a session from gateway service, update global state
                if (this.currentSession) {
                    this.globalSessionState.setActiveSession(this.currentSession);
                }
                
                // Update VS Code context
                await VSCodeUtils.setContext('flinkGatewayConnected', true);
                await VSCodeUtils.setContext('hasActiveSession', !!this.currentSession);
                await VSCodeUtils.setContext('workspaceHasFlinkSqlFiles', true);
            } else {
                this.currentSession = null;
                await VSCodeUtils.setContext('flinkGatewayConnected', false);
                await VSCodeUtils.setContext('hasActiveSession', false);
            }
        }, 'Loading session data', false);
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.collapsibleState);
        item.id = element.id;
        item.description = element.description;
        item.tooltip = element.tooltip;
        item.contextValue = element.contextValue;
        item.iconPath = element.iconPath;
        
        // Add command to set this session as active when clicked
        item.command = {
            command: 'flink-sql-workbench.setActiveSession',
            title: 'Set as Active Session',
            arguments: [element]
        };
        
        return item;
    }

    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (!element) {
            // Root level - return current session or empty
            if (this.currentSession) {
                const sessionItem: SessionItem = {
                    id: this.currentSession.sessionHandle,
                    label: this.currentSession.sessionName,
                    type: 'session',
                    sessionHandle: this.currentSession.sessionHandle,
                    isActive: true,
                    created: this.currentSession.created,
                    description: `Active since ${this.currentSession.created.toLocaleTimeString()}`,
                    tooltip: `Session: ${this.currentSession.sessionHandle}\nCreated: ${this.currentSession.created.toLocaleString()}`,
                    contextValue: 'session',  // Changed to 'session' to match package.json context menu
                    iconPath: new vscode.ThemeIcon('server-process'),
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                };
                return Promise.resolve([sessionItem]);
            }
            return Promise.resolve([]);
        }
        return Promise.resolve([]);
    }

    private async loadCurrentSession(): Promise<void> {
        try {
            if (this.gatewayService.isConnected()) {
                this.currentSession = await this.gatewayService.getCurrentSession();
                
                // Update context for welcome view
                vscode.commands.executeCommand('setContext', 'flinkGatewayConnected', true);
                vscode.commands.executeCommand('setContext', 'hasActiveSession', !!this.currentSession);
                vscode.commands.executeCommand('setContext', 'workspaceHasFlinkSqlFiles', true);
            } else {
                this.currentSession = null;
                vscode.commands.executeCommand('setContext', 'flinkGatewayConnected', false);
                vscode.commands.executeCommand('setContext', 'hasActiveSession', false);
            }
        } catch (error) {
            console.error('Error loading current session:', error);
            this.currentSession = null;
            vscode.commands.executeCommand('setContext', 'flinkGatewayConnected', false);
            vscode.commands.executeCommand('setContext', 'hasActiveSession', false);
        }
    }

    async createSession(sessionName?: string): Promise<void> {
        if (!sessionName) {
            sessionName = await vscode.window.showInputBox({
                prompt: 'Enter session name',
                placeHolder: 'my-session',
                value: 'vscode-session',
                validateInput: (value: string) => {
                    if (!value || value.trim().length === 0) {
                        return 'Session name cannot be empty';
                    }
                    return null;
                }
            });
        }

        if (sessionName) {
            const result = await this.gatewayService.createNewSession();
            if (result) {
                this.refresh();
                vscode.window.showInformationMessage(`Session '${sessionName}' created successfully`);
            } else {
                this.gatewayService.showOutput(); // Show the output panel
                vscode.window.showWarningMessage(`Failed to create session. Check the output panel for details.`);
            }
        }
    }

    async deleteSession(): Promise<void> {
        if (!this.currentSession) {
            vscode.window.showWarningMessage('No active session to delete');
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete session '${this.currentSession.sessionName}'?`,
            { modal: true },
            'Delete'
        );

        if (confirmation === 'Delete') {
            const sessionName = this.currentSession.sessionName; // Save name before deletion
            await this.gatewayService.deleteCurrentSession();
            
            // Assume success since deleteCurrentSession is void
            this.refresh();
            vscode.window.showInformationMessage(`Session '${sessionName}' deleted successfully`);
        }
    }

    async viewSessionInfo(): Promise<void> {
        if (!this.currentSession) {
            vscode.window.showWarningMessage('No active session');
            return;
        }

        const sessionInfo = await this.gatewayService.getSessionDetails();
        
        if (sessionInfo) {
            const panel = vscode.window.createWebviewPanel(
                'sessionInfo',
                `Session Info: ${this.currentSession.sessionName}`,
                vscode.ViewColumn.Two,
                { enableScripts: false }
            );

            panel.webview.html = this.getSessionInfoHtml({
                ...sessionInfo,
                sessionName: this.currentSession.sessionName,
                sessionHandle: this.currentSession.sessionHandle,
                created: this.currentSession.created
            });
        } else {
            this.gatewayService.showOutput(); // Show the output panel
            vscode.window.showWarningMessage(`Failed to get session info. Check the output panel for details.`);
        }
    }

    /**
     * Set a session as the active session
     */
    async setActiveSession(sessionItem: SessionItem): Promise<void> {
        if (!sessionItem) {
            return;
        }
        
        // Create a SessionInfo object from the SessionItem
        const sessionInfo: SessionInfo = {
            sessionHandle: sessionItem.sessionHandle,
            sessionName: sessionItem.label as string,
            created: sessionItem.created,
            isActive: true,
            properties: {} // Default empty properties
        };
        
        // Set as active in global state
        this.globalSessionState.setActiveSession(sessionInfo);
        
        // Update UI
        vscode.window.showInformationMessage(`Session '${sessionInfo.sessionName}' is now active`);
        this.refresh();
    }

    private getSessionInfoHtml(sessionInfo: any): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Session Information</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 16px;
                    }
                    .info-section {
                        margin-bottom: 20px;
                        padding: 12px;
                        background-color: var(--vscode-editor-widget-background);
                        border: 1px solid var(--vscode-widget-border);
                        border-radius: 4px;
                    }
                    .info-title {
                        font-weight: bold;
                        margin-bottom: 8px;
                        color: var(--vscode-symbolIcon-keywordForeground);
                    }
                    .info-item {
                        margin: 4px 0;
                        font-family: var(--vscode-editor-font-family);
                    }
                    .info-label {
                        font-weight: 500;
                        min-width: 120px;
                        display: inline-block;
                    }
                </style>
            </head>
            <body>
                <div class="info-section">
                    <div class="info-title">Session Details</div>
                    <div class="info-item">
                        <span class="info-label">Handle:</span>
                        <span>${sessionInfo.sessionHandle}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Name:</span>
                        <span>${sessionInfo.sessionName}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Created:</span>
                        <span>${sessionInfo.created?.toLocaleString() || 'Unknown'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Status:</span>
                        <span>${sessionInfo.status || 'Active'}</span>
                    </div>
                </div>
                
                ${sessionInfo.properties ? `
                <div class="info-section">
                    <div class="info-title">Configuration Properties</div>
                    ${Object.entries(sessionInfo.properties).map(([key, value]) => `
                        <div class="info-item">
                            <span class="info-label">${key}:</span>
                            <span>${value}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </body>
            </html>
        `;
    }
}



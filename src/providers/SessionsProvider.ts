import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';
import { SessionInfo } from '../types';

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentSession: SessionInfo | null = null;

    constructor(
        private readonly gatewayService: FlinkGatewayServiceAdapter,
        private readonly context: vscode.ExtensionContext
    ) {
        this.refresh();
    }

    // Dispose any resources held by this provider
    public dispose(): void {
        try {
            // No long-lived disposables currently, but keep defensive cleanup
            this._onDidChangeTreeData.dispose();
        } catch (e) {
            // ignore
        }
    }

    refresh(): void {
        this.loadCurrentSession();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (!element) {
            // Root level - return current session or empty
            if (this.currentSession) {
                return Promise.resolve([
                    new SessionItem(
                        this.currentSession.sessionName,
                        this.currentSession.sessionHandle,
                        true, // Always active since it's the only one
                        this.currentSession.created,
                        vscode.TreeItemCollapsibleState.None
                    )
                ]);
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

export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly sessionName: string,
        public readonly sessionHandle: string,
        public readonly isActive: boolean,
        public readonly created: Date,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(sessionName, collapsibleState);

        this.tooltip = `${this.sessionName} (${this.sessionHandle})${isActive ? ' - Active' : ''}`;
        this.description = isActive ? '● Active' : '';
        this.contextValue = 'session';
        
        if (isActive) {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }
    }
}

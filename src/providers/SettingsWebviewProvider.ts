import * as vscode from 'vscode';
import { DEFAULT_FLINK_GATEWAY_URL } from '../config';
import { CredentialService } from '../services/CredentialService';

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flink-sql-workbench.settings';

    private _view?: vscode.WebviewView;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    const messageListener = webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'updateSetting': {
                    this.updateSetting(data.key, data.value);
                    break;
                }
                case 'resetSettings': {
                    this.resetSettings();
                    break;
                }
                case 'exportSettings': {
                    this.exportSettings();
                    break;
                }
                case 'importSettings': {
                    this.importSettings();
                    break;
                }
                case 'testConnection': {
                    this.testConnection();
                    break;
                }
                case 'openCredentialManager': {
                    this.openCredentialManager();
                    break;
                }
                case 'refreshConnections': {
                    this.refresh();
                    break;
                }
            }
        });
    this.disposables.push(messageListener);
    }

    private updateSetting(key: string, value: any) {
        const config = vscode.workspace.getConfiguration();
        config.update(key, value, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Setting ${key} updated successfully`);
    }

    private resetSettings() {
        vscode.window.showWarningMessage(
            'Are you sure you want to reset all Flink SQL Workbench settings to defaults?',
            { modal: true },
            'Reset'
        ).then(selection => {
            if (selection === 'Reset') {
                const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');
                const keys = [
                    'gateway.url', 'gateway.connectionId', 'gateway.useProxy',
                    'gateway.apiVersion', 'gateway.sessionName', 'gateway.timeout', 'gateway.maxRetries',
                    'session.properties', 'session.autoReconnect', 'session.keepAliveInterval',
                    'editor.autoComplete', 'editor.autoSave', 'results.maxRows',
                    'results.pageSize', 'results.autoRefresh', 'results.refreshInterval',
                    'logging.level', 'logging.enableNetworkLogging', 'ui.theme',
                    'catalog.autoRefresh', 'jobs.autoRefresh', 'jobs.refreshInterval'
                ];
                
                keys.forEach(key => {
                    config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
                });
                
                vscode.window.showInformationMessage('Settings reset to defaults');
                this.refresh();
            }
        });
    }

    private async exportSettings() {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');
        const settings = {
            gateway: {
                url: config.get('gateway.url'),
                connectionId: config.get('gateway.connectionId'),
                useProxy: config.get('gateway.useProxy'),
                apiVersion: config.get('gateway.apiVersion'),
                sessionName: config.get('gateway.sessionName'),
                timeout: config.get('gateway.timeout'),
                maxRetries: config.get('gateway.maxRetries')
            },
            session: {
                properties: config.get('session.properties'),
                autoReconnect: config.get('session.autoReconnect'),
                keepAliveInterval: config.get('session.keepAliveInterval')
            },
            editor: {
                autoComplete: config.get('editor.autoComplete'),
                autoSave: config.get('editor.autoSave')
            },
            results: {
                maxRows: config.get('results.maxRows'),
                pageSize: config.get('results.pageSize'),
                autoRefresh: config.get('results.autoRefresh'),
                refreshInterval: config.get('results.refreshInterval')
            },
            logging: {
                level: config.get('logging.level'),
                enableNetworkLogging: config.get('logging.enableNetworkLogging')
            },
            ui: {
                theme: config.get('ui.theme')
            },
            catalog: {
                autoRefresh: config.get('catalog.autoRefresh')
            },
            jobs: {
                autoRefresh: config.get('jobs.autoRefresh'),
                refreshInterval: config.get('jobs.refreshInterval')
            }
        };

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('flink-workbench-settings.json'),
            filters: {
                'JSON Files': ['json']
            }
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(settings, null, 2)));
            vscode.window.showInformationMessage(`Settings exported to ${uri.fsPath}`);
        }
    }

    private async importSettings() {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'JSON Files': ['json']
            }
        });

        if (uris && uris[0]) {
            try {
                const content = await vscode.workspace.fs.readFile(uris[0]);
                const settings = JSON.parse(content.toString());
                
                const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');
                
                // Import settings recursively
                const importSection = (section: any, prefix: string = '') => {
                    for (const [key, value] of Object.entries(section)) {
                        const fullKey = prefix ? `${prefix}.${key}` : key;
                        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            importSection(value, fullKey);
                        } else {
                            config.update(fullKey, value, vscode.ConfigurationTarget.Workspace);
                        }
                    }
                };

                importSection(settings);
                vscode.window.showInformationMessage(`Settings imported from ${uris[0].fsPath}`);
                this.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import settings: ${error}`);
            }
        }
    }

    private async testConnection() {
        const { FlinkApiService, SessionManager } = require('../services');
        
        try {
            // Initialize services for testing
            const flinkApi = new FlinkApiService();
            
            // Load configuration
            const gatewayConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
            const url = gatewayConfig.get<string>('url', '');
            
            if (!url) {
                vscode.window.showErrorMessage('Gateway URL is not configured');
                return;
            }
            
            flinkApi.setBaseUrl(url);
            
            // Try to load credentials from Credential Manager
            try {
                await flinkApi.initializeFromCredentialManager();
            } catch (error) {
                // No credentials configured, test connection without authentication
                console.log('Testing connection without authentication');
            }
            
            // Test connection by creating a session
            const sessionManager = SessionManager.getInstance(flinkApi);
            const sessionInfo = await sessionManager.createSession();
            
            vscode.window.showInformationMessage(`Connection test successful! Session: ${sessionInfo.sessionHandle}`);
            
            // Clean up test session
            await sessionManager.closeSession();
            
        } catch (error) {
            vscode.window.showErrorMessage(`Connection test failed: ${error}`);
        }
    }

    private async openCredentialManager() {
        try {
            const credentialService = CredentialService.getInstance();
            await credentialService.openCredentialManager();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open Credential Manager: ${error}`);
        }
    }

    public refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }

    // Dispose resources used by this provider
    public dispose(): void {
        try {
            // If the view exists, dispose of any attached resources
            try {
                this.disposables.forEach(d => { try { d.dispose(); } catch (e) { /* ignore */ } });
                this.disposables = [];
            } catch (e) { /* ignore */ }
            this._view = undefined;
        } catch (e) {
            // ignore
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Flink SQL Workbench Settings</title>
            <style>
                body { 
                    font-family: var(--vscode-font-family);
                    padding: 10px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .section {
                    margin-bottom: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    padding: 15px;
                    border-radius: 4px;
                }
                .section h3 {
                    margin-top: 0;
                    color: var(--vscode-textPreformat-foreground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 5px;
                }
                .form-group {
                    margin-bottom: 10px;
                }
                label {
                    display: block;
                    margin-bottom: 3px;
                    font-weight: bold;
                    color: var(--vscode-input-foreground);
                }
                input, select, textarea {
                    width: 100%;
                    padding: 6px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 2px;
                    box-sizing: border-box;
                }
                input[type="checkbox"] {
                    width: auto;
                    margin-right: 5px;
                }
                .checkbox-group {
                    display: flex;
                    align-items: center;
                }
                .button-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 10px;
                }
                .button-group button {
                    flex: 1;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    margin: 5px 5px 5px 0;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 2px;
                }
                textarea {
                    height: 80px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                }
                .actions {
                    border-top: 1px solid var(--vscode-panel-border);
                    padding-top: 15px;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <h2>Flink SQL Workbench Settings</h2>
            
            <div class="section">
                <h3>Gateway Connection</h3>
                <div class="form-group">
                    <label for="gateway-url">Gateway URL (Fallback)</label>
              <input type="text" id="gateway-url" value="${config.get('gateway.url', DEFAULT_FLINK_GATEWAY_URL)}" 
                  onchange="updateSetting('flinkSqlWorkbench.gateway.url', this.value)">
              <div class="description">⚠️ DEPRECATED: Use Connection Manager instead. Fallback URL when no connectionId is configured</div>
                </div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="use-proxy" ${config.get('gateway.useProxy', false) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.gateway.useProxy', this.checked)">
                        <label for="use-proxy">Use Proxy</label>
                    </div>
                    <div class="description">Enable proxy for requests to avoid CORS issues</div>
                </div>
                
                <div class="form-group">
                    <label for="api-version">API Version</label>
                    <select id="api-version" onchange="updateSetting('flinkSqlWorkbench.gateway.apiVersion', this.value)">
                        <option value="auto" ${(config.get('gateway.apiVersion') as string) === 'auto' ? 'selected' : ''}>Auto-detect</option>
                        <option value="v1" ${(config.get('gateway.apiVersion') as string) === 'v1' ? 'selected' : ''}>v1</option>
                        <option value="v2" ${(config.get('gateway.apiVersion') as string) === 'v2' ? 'selected' : ''}>v2</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="timeout">Timeout (ms)</label>
                    <input type="number" id="timeout" value="${config.get('gateway.timeout', 30000)}" 
                           onchange="updateSetting('flinkSqlWorkbench.gateway.timeout', parseInt(this.value))">
                </div>

                <div class="form-group">
                    <label for="max-retries">Max Retries</label>
                    <input type="number" id="max-retries" value="${config.get('gateway.maxRetries', 3)}" 
                           onchange="updateSetting('flinkSqlWorkbench.gateway.maxRetries', parseInt(this.value))">
                </div>

                <button onclick="testConnection()">Test Connection</button>
            </div>

            <div class="section">
                <h3>Connection Management</h3>
                <div class="form-group">
                    <label for="connection-id">Connection ID</label>
                    <input type="text" id="connection-id" value="${config.get('gateway.connectionId', '')}" 
                           onchange="updateSetting('flinkSqlWorkbench.gateway.connectionId', this.value)">
                    <div class="description">ID of the connection from Credential Manager to use for authentication</div>
                </div>
                
                <div class="button-group">
                    <button onclick="openCredentialManager()">Open Connection Manager</button>
                    <button onclick="refreshConnections()">Refresh</button>
                </div>
                
                <div class="description">
                    <p>Use the Credential Manager extension to securely store and manage connection credentials for Flink Gateway.</p>
                    <p>After creating a connection in the Credential Manager, enter its ID above to use it for authentication.</p>
                </div>
            </div>

            <div class="section">
                <h3>Session</h3>
                <div class="form-group">
                    <label for="session-name">Session Name</label>
                    <input type="text" id="session-name" value="${config.get('gateway.sessionName', 'vscode-session')}" 
                           onchange="updateSetting('flinkSqlWorkbench.gateway.sessionName', this.value)">
                </div>

                <div class="form-group">
                    <label for="session-properties">Session Properties (JSON)</label>
                    <textarea id="session-properties" 
                              onchange="updateSetting('flinkSqlWorkbench.session.properties', JSON.parse(this.value))">${JSON.stringify(config.get('session.properties', {}), null, 2)}</textarea>
                    <div class="description">Default Flink session properties in JSON format</div>
                </div>

                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="auto-reconnect" ${config.get('session.autoReconnect', true) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.session.autoReconnect', this.checked)">
                        <label for="auto-reconnect">Auto Reconnect</label>
                    </div>
                </div>

                <div class="form-group">
                    <label for="keep-alive">Keep Alive Interval (ms)</label>
                    <input type="number" id="keep-alive" value="${config.get('session.keepAliveInterval', 300000)}" 
                           onchange="updateSetting('flinkSqlWorkbench.session.keepAliveInterval', parseInt(this.value))">
                </div>
            </div>

            <div class="section">
                <h3>Results</h3>
                <div class="form-group">
                    <label for="max-rows">Max Rows</label>
                    <input type="number" id="max-rows" value="${config.get('results.maxRows', 1000)}" 
                           onchange="updateSetting('flinkSqlWorkbench.results.maxRows', parseInt(this.value))">
                </div>

                <div class="form-group">
                    <label for="page-size">Page Size</label>
                    <input type="number" id="page-size" value="${config.get('results.pageSize', 100)}" 
                           onchange="updateSetting('flinkSqlWorkbench.results.pageSize', parseInt(this.value))">
                </div>

                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="auto-refresh-results" ${config.get('results.autoRefresh', false) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.results.autoRefresh', this.checked)">
                        <label for="auto-refresh-results">Auto Refresh Results</label>
                    </div>
                </div>

                <div class="form-group">
                    <label for="refresh-interval">Refresh Interval (ms)</label>
                    <input type="number" id="refresh-interval" value="${config.get('results.refreshInterval', 5000)}" 
                           onchange="updateSetting('flinkSqlWorkbench.results.refreshInterval', parseInt(this.value))">
                </div>
            </div>

            <div class="section">
                <h3>Jobs & Catalog</h3>
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="catalog-auto-refresh" ${config.get('catalog.autoRefresh', false) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.catalog.autoRefresh', this.checked)">
                        <label for="catalog-auto-refresh">Auto Refresh Catalog</label>
                    </div>
                </div>

                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="jobs-auto-refresh" ${config.get('jobs.autoRefresh', false) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.jobs.autoRefresh', this.checked)">
                        <label for="jobs-auto-refresh">Auto Refresh Jobs</label>
                    </div>
                </div>

                <div class="form-group">
                    <label for="jobs-refresh-interval">Jobs Refresh Interval (ms)</label>
                    <input type="number" id="jobs-refresh-interval" value="${config.get('jobs.refreshInterval', 10000)}" 
                           onchange="updateSetting('flinkSqlWorkbench.jobs.refreshInterval', parseInt(this.value))">
                </div>
            </div>

            <div class="section">
                <h3>Logging</h3>
                <div class="form-group">
                    <label for="log-level">Log Level</label>
                    <select id="log-level" onchange="updateSetting('flinkSqlWorkbench.logging.level', this.value)">
                        <option value="trace" ${(config.get('logging.level') as string) === 'trace' ? 'selected' : ''}>Trace</option>
                        <option value="debug" ${(config.get('logging.level') as string) === 'debug' ? 'selected' : ''}>Debug</option>
                        <option value="info" ${(config.get('logging.level') as string) === 'info' ? 'selected' : ''}>Info</option>
                        <option value="warn" ${(config.get('logging.level') as string) === 'warn' ? 'selected' : ''}>Warn</option>
                        <option value="error" ${(config.get('logging.level') as string) === 'error' ? 'selected' : ''}>Error</option>
                    </select>
                </div>

                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="network-logging" ${config.get('logging.enableNetworkLogging', false) ? 'checked' : ''}
                               onchange="updateSetting('flinkSqlWorkbench.logging.enableNetworkLogging', this.checked)">
                        <label for="network-logging">Enable Network Logging</label>
                    </div>
                    <div class="description">Log detailed HTTP requests and responses</div>
                </div>
            </div>

            <div class="actions">
                <button onclick="exportSettings()">Export Settings</button>
                <button onclick="importSettings()" class="secondary">Import Settings</button>
                <button onclick="resetSettings()" class="secondary">Reset to Defaults</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function updateSetting(key, value) {
                    vscode.postMessage({
                        type: 'updateSetting',
                        key: key,
                        value: value
                    });
                }

                function testConnection() {
                    vscode.postMessage({
                        type: 'testConnection'
                    });
                }

                function exportSettings() {
                    vscode.postMessage({
                        type: 'exportSettings'
                    });
                }

                function importSettings() {
                    vscode.postMessage({
                        type: 'importSettings'
                    });
                }

                function resetSettings() {
                    vscode.postMessage({
                        type: 'resetSettings'
                    });
                }

                function openCredentialManager() {
                    vscode.postMessage({
                        type: 'openCredentialManager'
                    });
                }

                function refreshConnections() {
                    vscode.postMessage({
                        type: 'refreshConnections'
                    });
                }
            </script>
        </body>
        </html>`;
    }
}

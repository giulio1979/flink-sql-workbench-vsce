import * as vscode from 'vscode';
import { SimpleConnection } from './services/SimpleConnection';
import { ConnectionsProvider } from './providers/ConnectionsProvider';
import { SessionsProvider } from './providers/SessionsProvider';
import { CatalogProvider } from './providers/CatalogProvider';
import { JobsProvider } from './providers/JobsProvider';
import { ResultsWebviewProvider } from './providers/ResultsWebviewProvider';
import { FlinkSqlEditorProvider } from './providers/FlinkSqlEditorProvider';
import { CredentialManagerService } from './services/CredentialManagerService';
import { FlinkApiService } from './services/FlinkApiService';
import { FlinkGatewayServiceAdapter } from './services/FlinkGatewayServiceAdapter';
import { SessionManager } from './services/SessionManager';
import { StatementManager } from './services/StatementManager';
import { GlobalErrorHandler, UserNotificationService } from './utils/errors';

let connectionsProvider: ConnectionsProvider;
let sessionsProvider: SessionsProvider;
let catalogProvider: CatalogProvider;
let jobsProvider: JobsProvider;
let resultsProvider: ResultsWebviewProvider;
let editorProvider: FlinkSqlEditorProvider;
let gatewayService: FlinkGatewayServiceAdapter;
let sessionManager: SessionManager;
let statementManager: StatementManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Flink SQL Workbench extension is activating...');

    // Initialize error handling
    GlobalErrorHandler.initialize();

    // Initialize credential manager service
    CredentialManagerService.initialize(context);
    
    // Ensure credential manager extension is activated early
    try {
        await CredentialManagerService.ensureCredentialManagerExtensionActive();
    } catch (error) {
        console.log('Warning: Could not activate credential manager extension. Some features may be limited.');
    }

    // Initialize services
    const flinkApi = new FlinkApiService();
    sessionManager = SessionManager.getInstance(flinkApi);
    statementManager = new StatementManager(flinkApi);
    gatewayService = new FlinkGatewayServiceAdapter(statementManager, sessionManager, flinkApi);

    // Initialize providers
    connectionsProvider = new ConnectionsProvider();
    sessionsProvider = new SessionsProvider(gatewayService, context);
    catalogProvider = new CatalogProvider(gatewayService, context);
    jobsProvider = new JobsProvider(gatewayService, context);
    resultsProvider = new ResultsWebviewProvider(context, statementManager);
    editorProvider = new FlinkSqlEditorProvider(context, statementManager, resultsProvider);

    // Create tree views
    vscode.window.createTreeView('flinkSqlConnections', { 
        treeDataProvider: connectionsProvider,
        canSelectMany: false 
    });

    vscode.window.createTreeView('flinkSqlSessions', {
        treeDataProvider: sessionsProvider,
        canSelectMany: false
    });

    vscode.window.createTreeView('flinkSqlCatalog', {
        treeDataProvider: catalogProvider,
        canSelectMany: false
    });

    vscode.window.createTreeView('flinkSqlJobs', {
        treeDataProvider: jobsProvider,
        canSelectMany: false
    });

    // Register custom editor
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('flink-sql-workbench.sqlEditor', editorProvider)
    );

    const commands = [
        // Connection management commands
        vscode.commands.registerCommand('flink-sql-workbench.connectToGateway', async () => {
            await GlobalErrorHandler.withErrorHandling(async () => {
                // Connect using the current connection from Simple Connection
                const connectionName = SimpleConnection.getConnectionName();
                if (connectionName === 'Not Connected') {
                    await UserNotificationService.showWarning('No connection selected. Please select a connection first.');
                    return;
                }
                
                // Ensure we have a session
                if (!gatewayService.isConnected()) {
                    const success = await gatewayService.createNewSession();
                    if (!success) {
                        await UserNotificationService.showError('Failed to create a session. Please try again.');
                        return;
                    }
                }
                
                // Connection is established through SimpleConnection
                sessionsProvider.refresh();
                catalogProvider.refresh();
                jobsProvider.refresh();
                await UserNotificationService.showInfo('Connected to Flink Gateway successfully');
            }, 'Connect to Gateway');
        }),

        vscode.commands.registerCommand('flink-sql-workbench.disconnectFromGateway', () => {
            GlobalErrorHandler.withErrorHandling(async () => {
                connectionsProvider.disconnect();
                await UserNotificationService.showInfo('Disconnected from gateway');
            }, 'Disconnect from Gateway');
        }),

        vscode.commands.registerCommand('flink-sql-workbench.refreshConnections', () => {
            connectionsProvider.refresh();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.selectConnection', async () => {
            const connections = SimpleConnection.getAvailableConnections();
            
            if (connections.length === 0) {
                vscode.window.showInformationMessage('No connections available. Please configure connections in the credential manager.');
                return;
            }

            const items = connections.map(conn => ({
                label: conn.name,
                description: conn.url,
                detail: `ID: ${conn.id}${conn.useProxy ? ' (via proxy)' : ''}`,
                connectionData: conn
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a Flink Gateway connection',
                ignoreFocusOut: true
            });

            if (selected) {
                const conn = selected.connectionData;
                await SimpleConnection.connect(conn.id, conn.name, conn.url, conn.useProxy);
                connectionsProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('flinkSqlWorkbench.openCredentialManager', async () => {
            // Open credential manager extension view
            const candidateCommands = [
                'workbench.view.extension.credential-manager',
                'credential-manager.open',
                'extension.credential-manager.focus',
                'workbench.view.extensions'
            ];

            let opened = false;
            for (const cmd of candidateCommands) {
                try {
                    await vscode.commands.executeCommand(cmd);
                    opened = true;
                    break;
                } catch (err) {
                    // Try next candidate
                }
            }

            if (!opened) {
                try {
                    await vscode.commands.executeCommand('workbench.extensions.search', '@id:IuliusHutuleac.credential-manager');
                } catch (err) {
                    vscode.window.showErrorMessage('Could not open Credential Manager view. Please ensure the extension "IuliusHutuleac.credential-manager" is installed and enabled.');
                }
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.clearConnection', () => {
            connectionsProvider.disconnect();
        }),

        // Session management commands
        vscode.commands.registerCommand('flink-sql-workbench.refreshSessions', () => {
            sessionsProvider.refresh();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.createSession', async () => {
            await sessionsProvider.createSession();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.deleteSession', async () => {
            await sessionsProvider.deleteSession();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.viewSessionInfo', async () => {
            await sessionsProvider.viewSessionInfo();
        }),
        
        vscode.commands.registerCommand('flink-sql-workbench.setActiveSession', async (item) => {
            if (item) {
                await sessionsProvider.setActiveSession(item);
            }
        }),

        // Catalog management commands
        vscode.commands.registerCommand('flink-sql-workbench.refreshCatalog', () => {
            catalogProvider.refresh();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.setCatalog', async (item) => {
            if (item && item.label) {
                await catalogProvider.setCatalog(item.label);
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.insertTableReference', async (item) => {
            if (item) {
                const catalogName = item.catalogName || item.label;
                const databaseName = item.databaseName;
                const tableName = item.tableName;
                await catalogProvider.insertTableReference(catalogName, databaseName, tableName);
            }
        }),

        // Job management commands
        vscode.commands.registerCommand('flink-sql-workbench.refreshJobs', () => {
            jobsProvider.refresh();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.toggleJobsAutoRefresh', async () => {
            await jobsProvider.toggleAutoRefresh();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.stopJob', async (item) => {
            if (item && item.job && item.job.id) {
                await jobsProvider.stopJob(item.job.id);
            }
        }),

        // Query execution commands
        vscode.commands.registerCommand('flink-sql-workbench.executeQuery', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const document = editor.document;
            if (document.languageId !== 'flinksql') {
                vscode.window.showWarningMessage('Current file is not a Flink SQL file');
                return;
            }

            // Get selected text or entire document
            let query = '';
            if (!editor.selection.isEmpty) {
                query = document.getText(editor.selection);
            } else {
                query = document.getText();
            }

            if (!query.trim()) {
                vscode.window.showWarningMessage('No query to execute');
                return;
            }

            try {
                // Always show results panel first
                resultsProvider.show();
                vscode.window.showInformationMessage('Query execution started. Check Results panel for output.');
                
                console.log(`Executing single query: ${query.substring(0, 50)}...`);
                const result = await statementManager.executeSQL(query);
                console.log(`Single query result:`, {
                    status: result.status,
                    stateExists: !!result.state,
                    columnsCount: result.state?.columns?.length || 0,
                    resultsCount: result.state?.results?.length || 0,
                    error: result.error
                });
                
                if (result.status === 'COMPLETED' && result.state) {
                    const queryResult = {
                        columns: result.state.columns || [],
                        results: result.state.results || [],
                        executionTime: result.state.lastUpdateTime || 0,
                        affectedRows: result.state.results ? result.state.results.length : 0,
                        error: result.error
                    };
                    console.log(`Updating single query results with:`, {
                        columns: queryResult.columns.length,
                        rows: queryResult.results.length
                    });
                    resultsProvider.updateResults(queryResult, result.statementId);
                    vscode.window.showInformationMessage(`Query completed with ${queryResult.affectedRows} rows`);
                } else {
                    console.log(`Single query not completed - Status: ${result.status}`);
                    // Show partial results even if not completed
                    const queryResult = {
                        columns: result.state?.columns || [],
                        results: result.state?.results || [],
                        executionTime: result.state?.lastUpdateTime || 0,
                        affectedRows: result.state?.results ? result.state.results.length : 0,
                        error: result.error || `Status: ${result.status}`
                    };
                    resultsProvider.updateResults(queryResult, result.statementId);
                    vscode.window.showWarningMessage(`Query execution status: ${result.status}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Query execution failed: ${error}`);
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.executeAllQueries', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const document = editor.document;
            if (document.languageId !== 'flinksql') {
                vscode.window.showWarningMessage('Current file is not a Flink SQL file');
                return;
            }

            const allText = document.getText();
            if (!allText.trim()) {
                vscode.window.showWarningMessage('No queries to execute');
                return;
            }

            // Split by semicolon and execute each statement
            const statements = allText.split(';').map(s => s.trim()).filter(s => s.length > 0);
            
            // Always show results panel first
            resultsProvider.show();
            vscode.window.showInformationMessage(`Executing ${statements.length} statements. Check Results panel for output.`);
            
            for (const statement of statements) {
                try {
                    console.log(`Executing statement: ${statement.substring(0, 50)}...`);
                    const result = await statementManager.executeSQL(statement);
                    console.log(`Statement result:`, {
                        status: result.status,
                        stateExists: !!result.state,
                        columnsCount: result.state?.columns?.length || 0,
                        resultsCount: result.state?.results?.length || 0,
                        error: result.error
                    });
                    
                    if (result.status === 'COMPLETED' && result.state) {
                        const queryResult = {
                            columns: result.state.columns || [],
                            results: result.state.results || [],
                            executionTime: result.state.lastUpdateTime || 0,
                            affectedRows: result.state.results ? result.state.results.length : 0,
                            error: result.error
                        };
                        console.log(`Updating results with:`, {
                            columns: queryResult.columns.length,
                            rows: queryResult.results.length
                        });
                        resultsProvider.updateResults(queryResult, result.statementId);
                    } else {
                        console.log(`Statement not completed or no state - Status: ${result.status}`);
                        // Show partial results even if not completed
                        const queryResult = {
                            columns: result.state?.columns || [],
                            results: result.state?.results || [],
                            executionTime: result.state?.lastUpdateTime || 0,
                            affectedRows: result.state?.results ? result.state.results.length : 0,
                            error: result.error || `Status: ${result.status}`
                        };
                        resultsProvider.updateResults(queryResult, result.statementId);
                    }
                } catch (error) {
                    console.error(`Statement execution error:`, error);
                    vscode.window.showErrorMessage(`Query execution failed: ${error}`);
                    break; // Stop on first error
                }
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.stopQuery', async () => {
            try {
                const results = await statementManager.cancelAllStatements();
                const successCount = results.filter(r => r.success).length;
                const errorCount = results.length - successCount;
                
                if (errorCount === 0) {
                    vscode.window.showInformationMessage(`Cancelled ${successCount} active queries`);
                } else {
                    vscode.window.showWarningMessage(`Cancelled ${successCount} queries, ${errorCount} failed to cancel`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to cancel queries: ${error}`);
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.showResults', () => {
            resultsProvider.show();
        }),

        vscode.commands.registerCommand('flink-sql-workbench.testResults', () => {
            console.log('Testing results panel...');
            resultsProvider.show();
            
            // Create sample data for testing
            const testResult = {
                columns: [
                    { name: 'id', logicalType: { type: 'INTEGER', nullable: false } },
                    { name: 'name', logicalType: { type: 'VARCHAR', nullable: true } },
                    { name: 'value', logicalType: { type: 'DOUBLE', nullable: true } }
                ],
                results: [
                    { id: 1, name: 'Test Row 1', value: 123.45 },
                    { id: 2, name: 'Test Row 2', value: 678.90 },
                    { id: 3, name: 'Test Row 3', value: 999.99 }
                ],
                executionTime: Date.now(),
                affectedRows: 3,
                error: undefined
            };
            
            console.log('Updating results with test data:', testResult);
            resultsProvider.updateResults(testResult, `test_${Date.now()}`);
            vscode.window.showInformationMessage('Test results displayed in Results panel');
        }),

        vscode.commands.registerCommand('flink-sql-workbench.testEmptyResults', () => {
            console.log('Testing empty results panel...');
            resultsProvider.show();
            
            // Test empty results case
            const emptyResult = {
                columns: [],
                results: [],
                executionTime: Date.now(),
                affectedRows: 0,
                error: undefined
            };
            
            console.log('Updating results with empty data:', emptyResult);
            resultsProvider.updateResults(emptyResult, `empty_test_${Date.now()}`);
            vscode.window.showInformationMessage('Empty test results displayed in Results panel');
        }),

        vscode.commands.registerCommand('flink-sql-workbench.showOutput', () => {
            if (gatewayService) {
                gatewayService.showOutput();
            }
        }),

        vscode.commands.registerCommand('flink-sql-workbench.openSettings', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'flinkSqlWorkbench');
        })
    ];

    context.subscriptions.push(...commands);
    
    console.log('Flink SQL Workbench extension activated successfully');
}

export function deactivate(): void {
    SimpleConnection.disconnect();
}

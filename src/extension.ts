import * as vscode from 'vscode';
import { 
    FlinkApiService, 
    StatementManager, 
    SessionManager,
    FlinkGatewayServiceAdapter,
    logger,
    NewSessionInfo,
    GlobalStatementEvent
} from './services';
import { QueryResult } from './types';
import { ExecutionResult } from './services/StatementExecutionEngine';

// Import providers
import { FlinkSqlEditorProvider } from './providers/FlinkSqlEditorProvider';
import { ResultsWebviewProvider } from './providers/ResultsWebviewProvider';
import { SessionsProvider } from './providers/SessionsProvider';
import { JobsProvider } from './providers/JobsProvider';
import { CatalogProvider } from './providers/CatalogProvider';
import { SettingsWebviewProvider } from './providers/SettingsWebviewProvider';

// Global services
let flinkApi: FlinkApiService;
let statementManager: StatementManager;
let sessionManager: SessionManager;
let gatewayAdapter: FlinkGatewayServiceAdapter;

// Providers
let editorProvider: FlinkSqlEditorProvider;
let resultsProvider: ResultsWebviewProvider;
let sessionsProvider: SessionsProvider;
let jobsProvider: JobsProvider;
let catalogProvider: CatalogProvider;
let settingsProvider: SettingsWebviewProvider;

// Converter function from ExecutionResult to QueryResult
function convertExecutionResultToQueryResult(executionResult: ExecutionResult): QueryResult {
    return {
        columns: executionResult.state.columns.map(col => ({
            name: col.name,
            logicalType: {
                type: col.logicalType.type,
                nullable: col.logicalType.nullable
            }
        })),
        results: executionResult.state.results,
        executionTime: executionResult.state.lastUpdateTime || 0,
        error: executionResult.error
    };
}

export function activate(context: vscode.ExtensionContext) {
    logger.info('Activating Flink SQL Workbench extension with new robust services...');

    try {
        // Initialize services
        initializeServices();
        
        // Register providers
        registerProviders(context);
        
        // Register commands
        registerCommands(context);
        
        // Setup event listeners
        setupEventListeners();
        
        logger.info('Flink SQL Workbench extension activated successfully');
    } catch (error: any) {
        logger.error(`Failed to activate extension: ${error.message}`);
        vscode.window.showErrorMessage(`Failed to activate Flink SQL Workbench: ${error.message}`);
    }
}

function initializeServices(): void {
    logger.info('Initializing Flink services...');
    
    // Load configuration
    const gatewayConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
    
    // Initialize FlinkApiService
    const url = gatewayConfig.get<string>('url', 'http://localhost:8083');
    flinkApi = new FlinkApiService(url);
    
    // Set credentials if provided
    const username = gatewayConfig.get<string>('authentication.username');
    const password = gatewayConfig.get<string>('authentication.password');
    const apiToken = gatewayConfig.get<string>('authentication.apiToken');
    
    if (username || password || apiToken) {
        flinkApi.setCredentials(username, password, apiToken);
    }
    
    // Initialize StatementManager and SessionManager
    statementManager = new StatementManager(flinkApi);
    sessionManager = SessionManager.getInstance(flinkApi);
    
    // Create adapter for legacy provider compatibility
    gatewayAdapter = new FlinkGatewayServiceAdapter(statementManager, sessionManager, flinkApi);
    
    logger.info('Services initialized successfully');
}

function registerProviders(context: vscode.ExtensionContext): void {
    logger.info('Registering providers...');
    
    // Create providers with new services
    resultsProvider = new ResultsWebviewProvider(context);
    editorProvider = new FlinkSqlEditorProvider(context, statementManager, resultsProvider);
    sessionsProvider = new SessionsProvider(gatewayAdapter, context);
    jobsProvider = new JobsProvider(gatewayAdapter, context);
    catalogProvider = new CatalogProvider(gatewayAdapter, context);
    settingsProvider = new SettingsWebviewProvider(context.extensionUri);

    // Register custom editor provider
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'flink-sql-workbench.sqlEditor',
            editorProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            }
        )
    );

    // Register webview providers - none currently defined in package.json

    // Register tree data providers
    context.subscriptions.push(
        vscode.window.createTreeView('flinkSqlSessions', {
            treeDataProvider: sessionsProvider
        })
    );
    context.subscriptions.push(
        vscode.window.createTreeView('flinkSqlJobs', {
            treeDataProvider: jobsProvider
        })
    );
    context.subscriptions.push(
        vscode.window.createTreeView('flinkSqlCatalog', {
            treeDataProvider: catalogProvider
        })
    );

    logger.info('Providers registered successfully');
    
    // Set context for views visibility
    vscode.commands.executeCommand('setContext', 'workspaceHasFlinkSqlFiles', true);
}

function registerCommands(context: vscode.ExtensionContext): void {
    logger.info('Registering commands...');

    // Execute selected SQL command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.executeQuery', async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const selection = activeEditor.selection;
            let sqlToExecute: string;

            if (selection.isEmpty) {
                // No selection, execute entire document
                sqlToExecute = activeEditor.document.getText();
            } else {
                // Execute selected text
                sqlToExecute = activeEditor.document.getText(selection);
            }

            if (!sqlToExecute.trim()) {
                vscode.window.showWarningMessage('No SQL to execute');
                return;
            }

            try {
                logger.info(`Executing SQL: ${sqlToExecute.substring(0, 100)}...`);
                
                // Show progress
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Executing SQL Statement",
                    cancellable: true
                }, async (progress, token) => {
                    
                    let currentStatementId: string | undefined;
                    
                    // Setup progress tracking
                    const progressObserver = (event: GlobalStatementEvent) => {
                        if (event.type === 'statement_update' && event.statementId === currentStatementId) {
                            const resultCount = event.state?.results?.length || 0;
                            progress.report({ 
                                message: `${resultCount} rows received...`,
                                increment: 10 
                            });
                        }
                    };
                    
                    statementManager.addGlobalObserver(progressObserver);
                    
                    try {
                        // Handle cancellation
                        token.onCancellationRequested(() => {
                            if (currentStatementId) {
                                statementManager.cancelStatement(currentStatementId);
                            }
                        });
                        
                        const result = await statementManager.executeSQL(sqlToExecute);
                        currentStatementId = result.statementId;
                        
                        if (result.status === 'COMPLETED') {
                            const rowCount = result.state.results.length;
                            const columnCount = result.state.columns.length;
                            
                            vscode.window.showInformationMessage(
                                `Query completed: ${rowCount} rows, ${columnCount} columns`
                            );
                            
                            // Update results view
                            resultsProvider.updateResults(convertExecutionResultToQueryResult(result));
                        } else if (result.status === 'CANCELLED') {
                            vscode.window.showWarningMessage('Query execution was cancelled');
                        } else {
                            vscode.window.showErrorMessage(`Query failed: ${result.message}`);
                        }
                        
                    } finally {
                        statementManager.removeGlobalObserver(progressObserver);
                    }
                });

            } catch (error: any) {
                logger.error(`Query execution failed: ${error.message}`);
                vscode.window.showErrorMessage(`Query execution failed: ${error.message}`);
            }
        })
    );

    // Execute all statements in file
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.executeAllQueries', async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const document = activeEditor.document;
            if (document.languageId !== 'flinksql') {
                vscode.window.showWarningMessage('Please open a Flink SQL file (.flink.sql)');
                return;
            }

            const content = document.getText().trim();
            if (!content) {
                vscode.window.showWarningMessage('File is empty');
                return;
            }

            // Split statements by semicolon (simple parsing)
            const statements = content
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0);

            if (statements.length === 0) {
                vscode.window.showWarningMessage('No SQL statements found');
                return;
            }

            try {
                logger.info(`Executing ${statements.length} statements`);
                
                let successCount = 0;
                let failCount = 0;

                for (const [index, statement] of Array.from(statements.entries())) {
                    try {
                        logger.info(`Executing statement ${index + 1}/${statements.length}: ${statement.substring(0, 50)}...`);
                        
                        const result = await statementManager.executeSQL(statement);
                        
                        if (result.status === 'COMPLETED') {
                            successCount++;
                            logger.info(`Statement ${index + 1} completed: ${result.state.results.length} rows`);
                        } else {
                            failCount++;
                            logger.error(`Statement ${index + 1} failed: ${result.message}`);
                        }
                        
                    } catch (error: any) {
                        failCount++;
                        logger.error(`Statement ${index + 1} error: ${error.message}`);
                    }
                }

                // Show summary
                if (failCount === 0) {
                    vscode.window.showInformationMessage(`All ${successCount} queries executed successfully`);
                } else if (successCount > 0) {
                    vscode.window.showWarningMessage(`${successCount} queries succeeded, ${failCount} failed. Check output for details.`);
                    logger.show();
                } else {
                    vscode.window.showErrorMessage(`All ${failCount} queries failed. Check output for details.`);
                    logger.show();
                }

            } catch (error: any) {
                logger.error(`Batch execution failed: ${error.message}`);
                vscode.window.showErrorMessage(`Batch execution failed: ${error.message}`);
            }
        })
    );

    // Connection management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.connectToGateway', async () => {
            try {
                const sessionInfo = await statementManager.createSession();
                vscode.window.showInformationMessage(`Connected to Flink Gateway: ${sessionInfo.sessionHandle}`);
                sessionsProvider.refresh();
            } catch (error: any) {
                logger.error(`Connection failed: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.disconnectFromGateway', async () => {
            try {
                await statementManager.closeSession();
                vscode.window.showInformationMessage('Disconnected from Flink Gateway');
                sessionsProvider.refresh();
            } catch (error: any) {
                logger.error(`Disconnect failed: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to disconnect: ${error.message}`);
            }
        })
    );

    // Session management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.refreshSessions', () => {
            sessionsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.createSession', async () => {
            try {
                const sessionInfo = await statementManager.createSession();
                vscode.window.showInformationMessage(`Session created: ${sessionInfo.sessionHandle}`);
                sessionsProvider.refresh();
            } catch (error: any) {
                logger.error(`Session creation failed: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to create session: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.deleteSession', async () => {
            try {
                await statementManager.closeSession();
                vscode.window.showInformationMessage('Session deleted');
                sessionsProvider.refresh();
            } catch (error: any) {
                logger.error(`Session deletion failed: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to delete session: ${error.message}`);
            }
        })
    );

    // Cancel commands
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.cancelAllStatements', async () => {
            try {
                const results = await statementManager.cancelAllStatements();
                const successCount = results.filter(r => r.success).length;
                const failCount = results.length - successCount;
                
                if (failCount === 0) {
                    vscode.window.showInformationMessage(`Cancelled ${successCount} statements`);
                } else {
                    vscode.window.showWarningMessage(`Cancelled ${successCount} statements, ${failCount} failed`);
                }
            } catch (error: any) {
                logger.error(`Cancel all failed: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to cancel statements: ${error.message}`);
            }
        })
    );

    // Utility commands
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.showOutput', () => {
            logger.show();
        })
    );

    // Show Results command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.showResults', () => {
            resultsProvider.show();
        })
    );

    // View Session Info command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.viewSessionInfo', async () => {
            try {
                const sessionInfo = sessionManager.getSessionInfo();
                if (sessionInfo) {
                    vscode.window.showInformationMessage(`Current Session: ${sessionInfo.sessionHandle}`);
                } else {
                    vscode.window.showWarningMessage('No active session');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to get session info: ${error.message}`);
            }
        })
    );

    // Refresh Catalog command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.refreshCatalog', () => {
            catalogProvider.refresh();
        })
    );

    // Refresh Jobs command  
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.refreshJobs', () => {
            jobsProvider.refresh();
        })
    );

    // Open Settings command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'flinkSqlWorkbench');
        })
    );

    // Test New Connection command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.testNewConnection', async () => {
            try {
                // Test the new services connection
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Testing Flink Gateway Connection",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: "Creating test session..." });
                    
                    // Create a test session to verify connection
                    const sessionInfo = await sessionManager.createSession();
                    
                    progress.report({ message: "Connection successful!" });
                    
                    vscode.window.showInformationMessage(
                        `✅ Connection test successful! Session: ${sessionInfo.sessionHandle}`
                    );
                    
                    // Clean up test session
                    await sessionManager.closeSession();
                });
            } catch (error: any) {
                logger.error(`Connection test failed: ${error.message}`);
                vscode.window.showErrorMessage(`❌ Connection test failed: ${error.message}`);
            }
        })
    );

    // Execute Selected SQL (New Services) command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.executeSelectedNew', async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const selection = activeEditor.selection;
            let sqlToExecute: string;

            if (selection.isEmpty) {
                // No selection, execute entire document
                sqlToExecute = activeEditor.document.getText();
            } else {
                // Execute selected text
                sqlToExecute = activeEditor.document.getText(selection);
            }

            if (!sqlToExecute.trim()) {
                vscode.window.showWarningMessage('No SQL to execute');
                return;
            }

            try {
                logger.info(`🚀 Executing SQL with New Services: ${sqlToExecute.substring(0, 100)}...`);
                
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "🚀 Executing SQL (New Services)",
                    cancellable: true
                }, async (progress, token) => {
                    return await statementManager.executeSQL(sqlToExecute);
                });

                // Convert and show results
                resultsProvider.updateResults(convertExecutionResultToQueryResult(result));
                resultsProvider.show();

                const rowCount = result.state.results.length;
                vscode.window.showInformationMessage(
                    `✅ Query executed successfully! ${rowCount} rows returned`
                );

            } catch (error: any) {
                logger.error(`Query execution failed: ${error.message}`);
                vscode.window.showErrorMessage(`❌ Query execution failed: ${error.message}`);
            }
        })
    );

    // Show Session Info (New) command
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.showSessionInfo', async () => {
            try {
                const sessionInfo = sessionManager.getSessionInfo();
                if (sessionInfo) {
                    const sessionAge = sessionManager.getSessionAge();
                    const sessionHandle = sessionManager.getCurrentSessionHandle();
                    
                    const message = `📊 Session Information:\n\n` +
                        `🔗 Handle: ${sessionInfo.sessionHandle}\n` +
                        `📅 Created: ${sessionInfo.created.toLocaleString()}\n` +
                        `⏰ Age: ${sessionAge}\n` +
                        `🏷️ Name: ${sessionInfo.sessionName}`;
                    
                    vscode.window.showInformationMessage(message, { modal: true });
                } else {
                    vscode.window.showWarningMessage('No active session found');
                }
            } catch (error: any) {
                logger.error(`Failed to get session info: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to get session info: ${error.message}`);
            }
        })
    );

    // Provider-specific commands (basic implementations)
    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.setCatalog', async (catalogItem) => {
            vscode.window.showInformationMessage('Set Catalog functionality will be implemented');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.insertTableReference', async (tableItem) => {
            vscode.window.showInformationMessage('Insert Table Reference functionality will be implemented');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.toggleJobsAutoRefresh', () => {
            if (jobsProvider && typeof jobsProvider.toggleAutoRefresh === 'function') {
                jobsProvider.toggleAutoRefresh();
            } else {
                vscode.window.showInformationMessage('Toggle Auto Refresh functionality will be implemented');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.stopJob', async (jobItem) => {
            vscode.window.showInformationMessage('Stop Job functionality will be implemented');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flink-sql-workbench.cancelJob', async (jobItem) => {
            vscode.window.showInformationMessage('Cancel Job functionality will be implemented');
        })
    );

    logger.info('Commands registered successfully');
}

function setupEventListeners(): void {
    logger.info('Setting up event listeners...');

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('flinkSqlWorkbench.gateway')) {
            logger.info('Gateway configuration changed, reinitializing services...');
            
            // Reinitialize services with new configuration
            const gatewayConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
            const url = gatewayConfig.get<string>('url', 'http://localhost:8083');
            
            flinkApi.setBaseUrl(url);
            
            // Update credentials
            const username = gatewayConfig.get<string>('authentication.username');
            const password = gatewayConfig.get<string>('authentication.password');
            const apiToken = gatewayConfig.get<string>('authentication.apiToken');
            
            flinkApi.setCredentials(username, password, apiToken);
        }
    });

    // Listen for session changes
    statementManager.addSessionListener((sessionInfo: NewSessionInfo | null) => {
        if (sessionInfo) {
            logger.info(`Session updated: ${sessionInfo.sessionHandle}`);
        } else {
            logger.info('Session closed');
        }
        sessionsProvider.refresh();
    });

    // Listen for global statement events
    statementManager.addGlobalObserver((event: GlobalStatementEvent) => {
        switch (event.type) {
            case 'lifecycle':
                if (event.eventType === 'statement_started') {
                    logger.info(`Statement started: ${event.statementId}`);
                } else if (event.eventType === 'statement_completed') {
                    logger.info(`Statement completed: ${event.statementId}`);
                } else if (event.eventType === 'statement_error') {
                    logger.error(`Statement error: ${event.statementId} - ${event.error}`);
                }
                break;
                
            case 'statement_update':
                // Update results view with latest data
                if (event.state?.results && event.state?.columns && event.statementId) {
                    // Create a temporary ExecutionResult to convert
                    const tempResult: ExecutionResult = {
                        status: 'COMPLETED',
                        message: 'Update received',
                        state: event.state,
                        statementId: event.statementId
                    };
                    resultsProvider.updateResults(convertExecutionResultToQueryResult(tempResult));
                }
                break;
        }
    });

    logger.info('Event listeners setup complete');
}

export function deactivate(): void {
    logger.info('Deactivating Flink SQL Workbench extension...');
    
    try {
        // Dispose services
        if (statementManager) {
            statementManager.dispose();
        }
        
        if (flinkApi) {
            flinkApi.dispose();
        }
        
        logger.info('Extension deactivated successfully');
    } catch (error: any) {
        logger.error(`Error during deactivation: ${error.message}`);
    }
}

import * as vscode from 'vscode';
import { StatementManager } from '../services/StatementManager';
import { StatementExecutionEngine } from '../services/StatementExecutionEngine';
import { ResultsWebviewProvider } from './ResultsWebviewProvider';
import { QueryResult } from '../types';
import { logger } from '../services/logger';

export class FlinkSqlEditorProvider implements vscode.CustomTextEditorProvider {
    private executionEngines: Map<string, StatementExecutionEngine> = new Map();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly statementManager: StatementManager,
        private readonly resultsProvider: ResultsWebviewProvider
    ) {
        // No initialization needed for new services
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Setup webview options
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Set the webview's html content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Update webview content when document changes
        const updateWebview = () => {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        };

        // Hook up event handlers so that we can synchronize the webview with the text document
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // Make sure we get rid of the listener when our editor is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Receive message from the webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'executeQuery':
                    await this.executeQueryWithDeltaStream(message.query, webviewPanel);
                    break;
                case 'updateDocument':
                    this.updateTextDocument(document, message.text);
                    break;
            }
        });

        // Initialize webview content
        updateWebview();
    }

    private async executeQueryWithDeltaStream(query: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            // Use StatementManager directly which handles the execution engine internally
            const executionId = `exec_${Date.now()}`;

            // Execute the query using StatementManager
            const result = await this.statementManager.executeSQL(query, executionId);

            // Convert ExecutionResult to QueryResult format for the results provider
            const queryResult: QueryResult = {
                columns: result.state.columns.map(col => ({
                    name: col.name,
                    logicalType: {
                        type: col.logicalType.type,
                        nullable: col.logicalType.nullable
                    }
                })),
                results: result.state.results,
                executionTime: result.state.lastUpdateTime || 0,
                affectedRows: result.state.results.length,
                error: result.error
            };

            // Update results panel
            this.resultsProvider.show();
            this.resultsProvider.updateResults(queryResult);

            // Notify webview of final completion
            webviewPanel.webview.postMessage({
                type: 'queryExecuted',
                success: result.status === 'COMPLETED',
                message: result.message,
                error: result.error,
                finalRowCount: result.state.results.length
            });

            if (result.status === 'COMPLETED') {
                vscode.window.showInformationMessage(
                    `Query completed: ${result.state.results.length} rows (after changelog processing)`
                );
            } else if (result.status === 'ERROR') {
                vscode.window.showErrorMessage(`Query failed: ${result.error || result.message}`);
                logger.show();
            } else if (result.status === 'CANCELLED') {
                vscode.window.showWarningMessage('Query execution was cancelled');
            }

        } catch (error) {
            webviewPanel.webview.postMessage({
                type: 'queryExecuted',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            vscode.window.showErrorMessage(`Query execution failed: ${error}`);
            logger.show();
        }
    }

    // Keep the simple method as fallback for non-streaming queries
    private async executeQuery(query: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            // Execute the query using StatementManager
            const result = await this.statementManager.executeSQL(query);
            
            if (result.status === 'COMPLETED') {
                // Convert ExecutionResult to QueryResult format
                const queryResult: QueryResult = {
                    columns: result.state.columns.map(col => ({
                        name: col.name,
                        logicalType: {
                            type: col.logicalType.type,
                            nullable: col.logicalType.nullable
                        }
                    })),
                    results: result.state.results,
                    executionTime: result.state.lastUpdateTime || 0,
                    affectedRows: result.state.results.length,
                    error: result.error
                };

                // Show results panel
                this.resultsProvider.show();
                this.resultsProvider.updateResults(queryResult);
                
                // Notify webview of success
                webviewPanel.webview.postMessage({
                    type: 'queryExecuted',
                    success: true,
                    message: `Query completed: ${result.state.results.length} rows retrieved`
                });
                
                vscode.window.showInformationMessage(`Query completed: ${result.state.results.length} rows retrieved`);
            } else {
                // Query failed
                webviewPanel.webview.postMessage({
                    type: 'queryExecuted',
                    success: false,
                    error: result.error || 'Query execution failed'
                });
                
                vscode.window.showErrorMessage(`Query execution failed: ${result.error || result.message}`);
                logger.show();
            }
        } catch (error) {
            // Handle execution errors
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            webviewPanel.webview.postMessage({
                type: 'queryExecuted',
                success: false,
                error: errorMessage
            });
            
            vscode.window.showErrorMessage(`Query execution failed: ${errorMessage}`);
            logger.show();
        }
    }

    private updateTextDocument(document: vscode.TextDocument, text: string) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text
        );
        return vscode.workspace.applyEdit(edit);
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'editor.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'editor.css')
        );

        // Monaco Editor CDN
        const monacoLoaderUri = 'https://unpkg.com/monaco-editor@0.44.0/min/vs/loader.js';
        const monacoBaseUri = 'https://unpkg.com/monaco-editor@0.44.0/min/vs';

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Flink SQL Editor</title>
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div class="toolbar">
                    <button id="executeBtn" class="execute-btn">▶ Execute Query</button>
                    <button id="formatBtn" class="format-btn">Format SQL</button>
                    <span class="status" id="status">Ready</span>
                </div>
                <div id="editor-container"></div>
                
                <script src="${monacoLoaderUri}"></script>
                <script>
                    require.config({ paths: { vs: '${monacoBaseUri}' } });
                    require(['vs/editor/editor.main'], function() {
                        // Monaco editor is loaded, initialize our editor
                        initializeEditor();
                    });
                </script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}

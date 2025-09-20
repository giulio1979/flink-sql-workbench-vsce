import * as vscode from 'vscode';
import { QueryResult } from '../types';
import { escapeHtml, generateNonce } from '../utils/html';
import { StatementManager } from '../services/StatementManager';

export class ResultsWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private outputChannel: vscode.OutputChannel;
    private currentResult?: QueryResult;
    private currentStatementId?: string;
    private isPolling: boolean = false;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly statementManager?: StatementManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Flink SQL Results');
    }

    public show(): void {
        this.outputChannel.appendLine('[DEBUG] ResultsWebviewProvider.show() called');
        this.outputChannel.show(); // Show the output channel for debugging
        
        if (this.panel) {
            this.outputChannel.appendLine('[DEBUG] Panel exists, revealing in ViewColumn.Two');
            this.panel.reveal(vscode.ViewColumn.Two);
        } else {
            this.outputChannel.appendLine('[DEBUG] Creating new results panel...');
            this.panel = vscode.window.createWebviewPanel(
                'flinkSqlResults',
                'Flink SQL Results',
                {
                    viewColumn: vscode.ViewColumn.Two,
                    preserveFocus: false
                },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.webview.html = this.getWelcomeHtml();

            // Handle messages from the webview
            this.panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.type) {
                        case 'cancelQuery':
                            await this.cancelCurrentQuery();
                            break;
                    }
                },
                undefined,
                this.disposables
            );

            // Register dispose handler
            const onDidDispose = this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.isPolling = false;
                this.currentStatementId = undefined;
            });
            this.disposables.push(onDidDispose);
        }
    }

    public updateResults(results: QueryResult, statementId?: string): void {
        this.outputChannel.appendLine(`[DEBUG] ResultsWebviewProvider.updateResults() called with: columns=${results.columns?.length}, rows=${results.results?.length}, statementId=${statementId}`);
        
        this.currentResult = results;
        this.currentStatementId = statementId;
        this.isPolling = results.isStreaming || false;
        
        // Debug logging
        this.outputChannel.appendLine(`=== DEBUG: updateResults called ===`);
        this.outputChannel.appendLine(`Columns: ${results.columns.length}`);
        this.outputChannel.appendLine(`Results: ${results.results ? results.results.length : 'undefined'}`);
        this.outputChannel.appendLine(`Error: ${results.error || 'none'}`);
        this.outputChannel.appendLine(`isStreaming: ${results.isStreaming ? 'true' : 'false'}`);
        this.outputChannel.appendLine(`StatementId: ${statementId || 'none'}`);
        
        if (results.columns && results.columns.length > 0) {
            this.outputChannel.appendLine(`Column names: ${results.columns.map(c => typeof c === 'string' ? c : c.name).join(', ')}`);
        }
        
        if (results.results && results.results.length > 0 && results.results.length <= 3) {
            this.outputChannel.appendLine(`Sample rows: ${JSON.stringify(results.results, null, 2)}`);
        }
        
        if (this.panel) {
            this.outputChannel.appendLine('[DEBUG] Updating existing panel with results');
            this.panel.webview.html = this.getResultsHtml(results);
        } else {
            this.outputChannel.appendLine('[DEBUG] Panel does not exist, creating new one');
            // If panel doesn't exist, show it first
            this.show();
            // Set the HTML after the panel is created
            setTimeout(() => {
                if (this.panel) {
                    this.outputChannel.appendLine('[DEBUG] Setting HTML content for new panel');
                    this.panel.webview.html = this.getResultsHtml(results);
                } else {
                    this.outputChannel.appendLine('[ERROR] Panel still does not exist after show()');
                }
            }, 100);
        }
    }

    private async cancelCurrentQuery(): Promise<void> {
        if (!this.currentStatementId || !this.statementManager) {
            vscode.window.showWarningMessage('No active query to cancel');
            return;
        }

        try {
            const result = await this.statementManager.cancelStatement(this.currentStatementId);
            if (result.success) {
                this.isPolling = false;
                this.currentStatementId = undefined;
                vscode.window.showInformationMessage('Query cancelled successfully');
                
                // Update the webview to show cancellation
                if (this.panel) {
                    this.panel.webview.html = this.getCancelledHtml();
                }
            } else {
                vscode.window.showErrorMessage(`Failed to cancel query: ${result.message}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error cancelling query: ${error.message}`);
        }
    }

    private getWelcomeHtml(): string {
        const nonce = generateNonce();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Flink SQL Results</title>
        </head>
        <body>
            <h2>Flink SQL Results</h2>
            <p>Execute a Flink SQL query to see results here.</p>
        </body>
        </html>`;
    }

    private getCancelledHtml(): string {
        const nonce = generateNonce();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Query Cancelled</title>
            <style>
                .cancelled { color: orange; background: #fff3cd; padding: 10px; border: 1px solid orange; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h2>Query Cancelled</h2>
            <div class="cancelled">The query execution was cancelled by user request.</div>
        </body>
        </html>`;
    }

    private getResultsHtml(result: QueryResult): string {
        const nonce = generateNonce();
        
        // Add debugging to see what we're actually receiving
        this.outputChannel.appendLine(`=== DEBUGGING QUERY RESULT ===`);
        this.outputChannel.appendLine(`Columns: ${JSON.stringify(result.columns, null, 2)}`);
        this.outputChannel.appendLine(`First few results: ${JSON.stringify(result.results?.slice(0, 3), null, 2)}`);
        this.outputChannel.appendLine(`Results length: ${result.results?.length}`);
        this.outputChannel.appendLine(`Error: ${result.error || 'none'}`);
        this.outputChannel.appendLine(`isStreaming: ${result.isStreaming ? 'true' : 'false'}`);
        this.outputChannel.show(); // Temporarily enable for debugging
        
        // Generate cancel button HTML if polling is active
        const cancelButtonHtml = this.isPolling && this.currentStatementId ? `
            <div style="margin-bottom: 15px;">
                <button id="cancelBtn" onclick="cancelQuery()" style="background-color: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                    Cancel Query
                </button>
                <span style="margin-left: 10px; color: #666;">Query is running...</span>
            </div>
        ` : '';

        // Generate script for cancel functionality
        const cancelScript = `
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                function cancelQuery() {
                    vscode.postMessage({ type: 'cancelQuery' });
                }
            </script>
        `;
        
        // Handle error case
        if (result.error) {
            return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Query Error</title>
                <style>
                    .error { color: red; background: #ffe6e6; padding: 10px; border: 1px solid red; margin: 10px 0; }
                </style>
            </head>
            <body>
                <h2>Query Execution Error</h2>
                ${cancelButtonHtml}
                <div class="error">${escapeHtml(result.error)}</div>
                <p>Execution time: ${result.executionTime}ms</p>
                ${cancelScript}
            </body>
            </html>`;
        }
        
        // Special case for DDL commands that might have non-standard results
        const isShowCommand = result.columns && result.columns.length === 1 && 
                            typeof result.columns[0] === 'object' && 
                            result.columns[0].name && 
                            (result.columns[0].name === 'database name' || 
                             result.columns[0].name === 'catalog name' || 
                             result.columns[0].name === 'table name' ||
                             result.columns[0].name.toLowerCase().includes('name'));

        // If no columns, this is likely a DDL command that doesn't return data
        if (!result.columns || result.columns.length === 0) {
            return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Query Executed Successfully</title>
                <style>
                    .success { color: green; background: #e6ffe6; padding: 10px; border: 1px solid green; margin: 10px 0; }
                </style>
            </head>
            <body>
                <h2>Query Execution Successful</h2>
                ${cancelButtonHtml}
                <div class="success">The command was executed successfully.</div>
                <p>Execution time: ${result.executionTime}ms</p>
                ${result.isStreaming ? '<p><strong>Note:</strong> This is a streaming query. Results will update in real-time.</p>' : ''}
                ${cancelScript}
            </body>
            </html>`;
        }
        
        // No results but columns exist (empty result set)
        if (!result.results || result.results.length === 0) {
            return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Query Results</title>
                <style>
                    .info { color: blue; background: #e6f2ff; padding: 10px; border: 1px solid blue; margin: 10px 0; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                </style>
            </head>
            <body>
                <h2>Query Results</h2>
                ${cancelButtonHtml}
                <div class="info">The query executed successfully but returned no results.</div>
                <p>Execution time: ${result.executionTime}ms</p>
                ${result.isStreaming ? '<p><strong>Note:</strong> This is a streaming query. Results will appear when data is available.</p>' : ''}
                ${cancelScript}
            </body>
            </html>`;
        }

        const headers = result.columns.map(column => {
            const columnName = typeof column === 'string' ? column : column.name || 'Unknown';
            return `<th>${escapeHtml(columnName)}</th>`;
        }).join('');

        // Debug rows to understand the structure
        this.outputChannel.appendLine(`First 3 row types:`);
        result.results.slice(0, 3).forEach((row, index) => {
            this.outputChannel.appendLine(`Row ${index} type: ${typeof row}, isArray: ${Array.isArray(row)}, keys: ${row && typeof row === 'object' ? Object.keys(row).join(', ') : 'n/a'}`);
        });

        const rows = result.results.map((row: any, rowIndex: number) => {
            let cells: string[] = [];
            
            // Debug each row to understand the structure
            if (rowIndex < 3) {
                this.outputChannel.appendLine(`Row ${rowIndex} structure: ${JSON.stringify(row)}, type: ${typeof row}, isArray: ${Array.isArray(row)}`);
            }
            
            if (row && typeof row === 'object' && row.fields && Array.isArray(row.fields)) {
                // Handle fields array format (from React implementation)
                cells = row.fields.map((field: any) => {
                    const cellValue = field !== null && field !== undefined ? String(field) : 'NULL';
                        return `<td>${escapeHtml(cellValue)}</td>`;
                });
            } else if (Array.isArray(row)) {
                // Handle array format
                cells = row.map((cell: any) => `<td>${escapeHtml(cell !== null && cell !== undefined ? String(cell) : 'NULL')}</td>`);
            } else if (row && typeof row === 'object') {
                // Handle object format with column names as keys
                cells = result.columns.map((column, colIndex) => {
                    const columnName = typeof column === 'string' ? column : column.name;
                    let value;
                    
                    if (row[columnName] !== undefined) {
                        // Direct column name match
                        value = row[columnName];
                    } else if (row[`field_${colIndex}`] !== undefined) {
                        // Generic field name (field_0, field_1, etc.)
                        value = row[`field_${colIndex}`];
                    } else {
                        // Try to find by index in case it's an array-like object
                        const keys = Object.keys(row);
                        if (rowIndex < 3) {
                            this.outputChannel.appendLine(`Available keys in row: ${keys.join(', ')}`);
                            this.outputChannel.appendLine(`Looking for column: ${columnName}`);
                        }
                        value = keys[colIndex] !== undefined ? row[keys[colIndex]] : null;
                    }
                    
                    const cellValue = value !== null && value !== undefined ? String(value) : 'NULL';
                    return `<td>${escapeHtml(cellValue)}</td>`;
                });
            } else {
                // Fallback: create empty cells
                this.outputChannel.appendLine(`Warning: Unexpected row format at index ${rowIndex}: ${typeof row}`);
                cells = result.columns.map(() => '<td>NULL</td>');
            }

            return `<tr>${cells.join('')}</tr>`;
        }).join('');

        // Create streaming status indicator if needed
        const streamingIndicator = result.isStreaming ? 
            `<div class="streaming-indicator">
                <span class="pulse"></span> Live Streaming Query - Results update automatically
             </div>` : '';
             
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Query Results</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 10px; }
                table { border-collapse: collapse; width: 100%; margin-top: 10px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; position: sticky; top: 0; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                tr:hover { background-color: #f1f1f1; }
                
                /* Streaming indicator styles */
                .streaming-indicator {
                    display: flex;
                    align-items: center;
                    background-color: #e6f7ff;
                    border: 1px solid #91d5ff;
                    padding: 8px 12px;
                    border-radius: 4px;
                    margin: 10px 0;
                    font-weight: bold;
                    color: #0050b3;
                }
                .pulse {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background-color: #1890ff;
                    margin-right: 8px;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0% { transform: scale(0.8); opacity: 0.8; }
                    50% { transform: scale(1.2); opacity: 1; }
                    100% { transform: scale(0.8); opacity: 0.8; }
                }
            </style>
        </head>
        <body>
            <h2>Query Results</h2>
            ${cancelButtonHtml}
            ${streamingIndicator}
            <p>Execution time: ${result.executionTime}ms | Total rows: ${result.results.length}</p>
            <table>
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
            
            <script nonce="${nonce}">
                // Simple auto-refresh for streaming results
                ${result.isStreaming ? `
                    // For streaming queries, scroll to bottom when new results arrive
                    window.scrollTo(0, document.body.scrollHeight);
                ` : ''}
            </script>
            ${cancelScript}
        </body>
        </html>`;
    }

    // Dispose resources held by this provider
    public dispose(): void {
        try {
            if (this.panel) {
                try {
                    this.panel.dispose();
                } catch (e) {
                    // ignore disposal errors
                }
                this.panel = undefined;
            }

            // Dispose registered disposables local to this provider
            try {
                this.disposables.forEach(d => {
                    try { d.dispose(); } catch (e) { /* ignore */ }
                });
                this.disposables = [];
            } catch (e) {
                // ignore
            }

            try {
                this.outputChannel.dispose();
            } catch (e) {
                // ignore
            }
        } catch (error) {
            // swallow - defensive cleanup should not throw
        }
    }
}

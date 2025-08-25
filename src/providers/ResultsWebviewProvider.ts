import * as vscode from 'vscode';
import { QueryResult } from '../services/FlinkGatewayService';

export class ResultsWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private outputChannel: vscode.OutputChannel;
    private currentResult?: QueryResult;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Flink SQL Results');
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'flinkSqlResults',
                'Flink SQL Results',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.webview.html = this.getWelcomeHtml();

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            }, null, this.context.subscriptions);
        }
    }

    public updateResults(results: QueryResult): void {
        this.currentResult = results;
        if (this.panel) {
            this.panel.webview.html = this.getResultsHtml(results);
        } else {
            // If panel doesn't exist, show it first
            this.show();
            // Set the HTML after the panel is created
            setTimeout(() => {
                if (this.panel) {
                    this.panel.webview.html = this.getResultsHtml(results);
                }
            }, 100);
        }
    }

    private getWelcomeHtml(): string {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Flink SQL Results</title>
        </head>
        <body>
            <h2>Flink SQL Results</h2>
            <p>Execute a Flink SQL query to see results here.</p>
        </body>
        </html>`;
    }

    private getResultsHtml(result: QueryResult): string {
        // Add debugging to see what we're actually receiving
        this.outputChannel.appendLine(`=== DEBUGGING QUERY RESULT ===`);
        this.outputChannel.appendLine(`Columns: ${JSON.stringify(result.columns, null, 2)}`);
        this.outputChannel.appendLine(`First few results: ${JSON.stringify(result.results?.slice(0, 3), null, 2)}`);
        this.outputChannel.appendLine(`Results length: ${result.results?.length}`);
        this.outputChannel.show(); // Show the output panel for debugging
        
        if (!result.columns || !result.results) {
            return this.getWelcomeHtml();
        }

        const headers = result.columns.map(column => {
            const columnName = typeof column === 'string' ? column : column.name || 'Unknown';
            return `<th>${columnName}</th>`;
        }).join('');

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
                    return `<td>${cellValue}</td>`;
                });
            } else if (Array.isArray(row)) {
                // Handle array format
                cells = row.map((cell: any) => `<td>${cell !== null && cell !== undefined ? String(cell) : 'NULL'}</td>`);
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
                    return `<td>${cellValue}</td>`;
                });
            } else {
                // Fallback: create empty cells
                this.outputChannel.appendLine(`Warning: Unexpected row format at index ${rowIndex}: ${typeof row}`);
                cells = result.columns.map(() => '<td>NULL</td>');
            }

            return `<tr>${cells.join('')}</tr>`;
        }).join('');

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Query Results</title>
            <style>
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
                th { background-color: #f4f4f4; }
            </style>
        </head>
        <body>
            <h3>Query Results (${result.results.length} rows)</h3>
            <table>
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </body>
        </html>`;
    }
}

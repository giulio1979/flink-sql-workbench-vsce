import * as vscode from 'vscode';
import { FlinkGatewayService } from '../services/FlinkGatewayService';
import { ResultsWebviewProvider } from './ResultsWebviewProvider';

export class FlinkSqlEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly gatewayService: FlinkGatewayService,
        private readonly resultsProvider: ResultsWebviewProvider
    ) {}

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
                    const result = await this.gatewayService.executeQuery(message.query);
                    if (result) {
                        this.resultsProvider.show();
                        this.resultsProvider.updateResults(result);
                        webviewPanel.webview.postMessage({
                            type: 'queryExecuted',
                            success: true
                        });
                    } else {
                        // Error is already logged to output channel in the service
                        this.gatewayService.showOutput();
                        webviewPanel.webview.postMessage({
                            type: 'queryExecuted',
                            success: false,
                            error: 'Query execution failed. Check the output panel for details.'
                        });
                    }
                    break;
                case 'updateDocument':
                    this.updateTextDocument(document, message.text);
                    break;
            }
        });

        // Initialize webview content
        updateWebview();
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

import * as vscode from 'vscode';
import { FlinkSqlEditorProvider } from './providers/FlinkSqlEditorProvider';
import { FlinkGatewayService } from './services/FlinkGatewayService';
import { ResultsWebviewProvider } from './providers/ResultsWebviewProvider';
import { SessionsProvider } from './providers/SessionsProvider';
import { CatalogProvider } from './providers/CatalogProvider';
import { JobsProvider } from './providers/JobsProvider';
import { SettingsWebviewProvider } from './providers/SettingsWebviewProvider';

// Global services
let gatewayService: FlinkGatewayService;
let resultsWebviewProvider: ResultsWebviewProvider;
let sessionsProvider: SessionsProvider;
let catalogProvider: CatalogProvider;
let jobsProvider: JobsProvider;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Flink SQL Workbench extension is now active!');

	// Initialize services
	gatewayService = new FlinkGatewayService();
	resultsWebviewProvider = new ResultsWebviewProvider(context);
	sessionsProvider = new SessionsProvider(gatewayService, context);
	catalogProvider = new CatalogProvider(gatewayService, context);
	jobsProvider = new JobsProvider(gatewayService, context);
	const settingsProvider = new SettingsWebviewProvider(context.extensionUri);

	// Set up session refresh callback so gateway service can notify all views
	gatewayService.setSessionRefreshCallback(() => {
		sessionsProvider.refresh();
		catalogProvider.refresh();
		jobsProvider.refresh();
	});

	// Set context for views visibility
	vscode.commands.executeCommand('setContext', 'workspaceHasFlinkSqlFiles', true);

	// Results provider doesn't need registration since it creates panels dynamically

	// Register tree views
	context.subscriptions.push(
		vscode.window.createTreeView('flinkSqlSessions', {
			treeDataProvider: sessionsProvider,
			showCollapseAll: false
		})
	);

	context.subscriptions.push(
		vscode.window.createTreeView('flinkSqlCatalog', {
			treeDataProvider: catalogProvider,
			showCollapseAll: true
		})
	);

	context.subscriptions.push(
		vscode.window.createTreeView('flinkSqlJobs', {
			treeDataProvider: jobsProvider,
			showCollapseAll: false
		})
	);

	// Register settings webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('flinkSqlSettings', settingsProvider)
	);

	// Register custom editor provider
	const editorProvider = new FlinkSqlEditorProvider(context, gatewayService, resultsWebviewProvider);
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

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.executeQuery', async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.fileName.endsWith('.flink.sql')) {
				const query = activeEditor.document.getText(activeEditor.selection.isEmpty ? undefined : activeEditor.selection);
				if (query.trim()) {
					const result = await gatewayService.executeQuery(query);
					if (result) {
						resultsWebviewProvider.show();
						resultsWebviewProvider.updateResults(result);
					} else {
						gatewayService.showOutput();
						vscode.window.showWarningMessage(`Query execution failed. Check the output panel for details.`);
					}
				} else {
					vscode.window.showWarningMessage('No query selected or file is empty');
				}
			} else {
				vscode.window.showWarningMessage('Please open a Flink SQL file (.flink.sql)');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.connectToGateway', async () => {
			const result = await gatewayService.connect();
			if (result) {
				vscode.window.showInformationMessage('Connected to Flink Gateway');
			} else {
				gatewayService.showOutput();
				vscode.window.showWarningMessage(`Failed to connect to Flink Gateway. Check the output panel for details.`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.disconnectFromGateway', async () => {
			await gatewayService.disconnect();
			vscode.window.showInformationMessage('Disconnected from Flink Gateway');
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
			await sessionsProvider.createSession();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.deleteSession', async () => {
			await sessionsProvider.deleteSession();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.viewSessionInfo', async () => {
			await sessionsProvider.viewSessionInfo();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.showResults', () => {
			resultsWebviewProvider.show();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.showOutput', () => {
			gatewayService.showOutput();
		})
	);

	// Catalog commands
	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.refreshCatalog', () => {
			catalogProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.setCatalog', async (item: any) => {
			if (item && item.catalogName) {
				await catalogProvider.setCatalog(item.catalogName);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.insertTableReference', async (item: any) => {
			if (item) {
				await catalogProvider.insertTableReference(
					item.catalogName,
					item.databaseName,
					item.tableName
				);
			}
		})
	);

	// Jobs commands
	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.refreshJobs', () => {
			jobsProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.toggleJobsAutoRefresh', () => {
			jobsProvider.toggleAutoRefresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.stopJob', async (item: any) => {
			if (item && item.job && item.job.id) {
				await jobsProvider.stopJob(item.job.id);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.cancelJob', async (item: any) => {
			if (item && item.job && item.job.id) {
				await jobsProvider.cancelJob(item.job.id);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flink-sql-workbench.openSettings', () => {
			vscode.commands.executeCommand('workbench.view.extension.explorer');
			vscode.commands.executeCommand('flinkSqlSettings.focus');
		})
	);

	// Auto-connect on startup if configured
	const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');
	if (config.get('gateway.autoConnect', false)) {
		gatewayService.connect().then((result) => {
			// Note: Session refresh will be triggered automatically via the callback
		}).catch((error: any) => {
			console.error('Auto-connect failed:', error);
		});
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (gatewayService) {
		gatewayService.disconnect();
	}
	if (jobsProvider) {
		jobsProvider.dispose();
	}
}

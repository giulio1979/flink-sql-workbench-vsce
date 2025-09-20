import * as vscode from 'vscode';
import { createModuleLogger } from '../services/logger';

const log = createModuleLogger('BaseUtils');

/**
 * Centralized notification service to replace scattered vscode.window.show* calls
 */
export class NotificationService {
    static showError(message: string, ...actions: string[]): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message, ...actions);
    }
    
    static showWarning(message: string, ...actions: string[]): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message, ...actions);
    }
    
    static showInfo(message: string, ...actions: string[]): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message, ...actions);
    }

    static async showConfirmation(message: string, confirmText: string = 'Yes', cancelText: string = 'No'): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(message, { modal: true }, confirmText, cancelText);
        return result === confirmText;
    }
}

/**
 * Enhanced logging service with level configuration
 */
export class LoggingService {
    private static level: 'debug' | 'info' | 'warn' | 'error' = 'info';
    private static outputChannel: vscode.OutputChannel | null = null;
    
    static configure(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
        this.level = level;
    }

    static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Flink SQL Workbench');
        }
        return this.outputChannel;
    }
    
    static debug(message: string, ...args: any[]) {
        if (this.level === 'debug') {
            console.log(`[DEBUG] ${message}`, ...args);
            this.getOutputChannel().appendLine(`[DEBUG] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}`);
        }
    }
    
    static info(message: string, ...args: any[]) {
        if (['debug', 'info'].includes(this.level)) {
            console.log(`[INFO] ${message}`, ...args);
            this.getOutputChannel().appendLine(`[INFO] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}`);
        }
    }
    
    static warn(message: string, ...args: any[]) {
        if (['debug', 'info', 'warn'].includes(this.level)) {
            console.warn(`[WARN] ${message}`, ...args);
            this.getOutputChannel().appendLine(`[WARN] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}`);
        }
    }
    
    static error(message: string, ...args: any[]) {
        console.error(`[ERROR] ${message}`, ...args);
        this.getOutputChannel().appendLine(`[ERROR] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}`);
    }
}

/**
 * Centralized configuration management with caching
 */
export class ConfigurationManager {
    private static cache = new Map<string, any>();
    private static disposables: vscode.Disposable[] = [];
    
    static initialize() {
        // Clear cache when configuration changes
        const disposable = vscode.workspace.onDidChangeConfiguration(() => {
            this.cache.clear();
        });
        this.disposables.push(disposable);
    }
    
    static dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.cache.clear();
    }
    
    static get<T>(key: string, defaultValue?: T): T {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        
        const config = vscode.workspace.getConfiguration();
        const value = config.get(key, defaultValue);
        this.cache.set(key, value);
        return value as T;
    }
    
    static async set(key: string, value: any, target?: vscode.ConfigurationTarget): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(key, value, target);
        this.cache.delete(key); // Invalidate cache for this key
    }
    
    static invalidateCache() {
        this.cache.clear();
    }
    
    static getFlinkGatewayConfig() {
        return {
            connectionId: this.get<string>('flinkSqlWorkbench.gateway.connectionId'),
            useProxy: this.get<boolean>('flinkSqlWorkbench.gateway.useProxy', false),
            timeout: this.get<number>('flinkSqlWorkbench.gateway.timeout', 30000),
        };
    }
    
    static getSessionConfig() {
        return {
            properties: this.get<Record<string, string>>('flinkSqlWorkbench.session.properties', {
                'execution.runtime-mode': 'streaming',
                'table.exec.resource.default-parallelism': '1',
                'execution.checkpointing.interval': '10s',
                'sql-gateway.session.idle-timeout': '30min',
                'sql-gateway.session.check-interval': '1min'
            }),
            autoRefresh: this.get<boolean>('flinkSqlWorkbench.session.autoRefresh', false),
        };
    }
    
    static getJobsConfig() {
        return {
            autoRefresh: this.get<boolean>('flinkSqlWorkbench.jobs.autoRefresh', false),
            refreshInterval: this.get<number>('flinkSqlWorkbench.jobs.refreshInterval', 10000),
        };
    }
}

/**
 * Common VS Code utility functions
 */
export class VSCodeUtils {
    /**
     * Generic picker dialog
     */
    static async showPickDialog<T>(
        items: T[], 
        labelExtractor: (item: T) => string,
        placeholder: string,
        descriptionExtractor?: (item: T) => string
    ): Promise<T | undefined> {
        const picks = items.map(item => ({
            label: labelExtractor(item),
            description: descriptionExtractor ? descriptionExtractor(item) : undefined,
            item
        }));
        
        const selected = await vscode.window.showQuickPick(picks, { 
            placeHolder: placeholder,
            canPickMany: false
        });
        return selected?.item;
    }
    
    /**
     * Input dialog with validation
     */
    static async showInputDialog(
        prompt: string,
        placeholder?: string,
        defaultValue?: string,
        validator?: (value: string) => string | null
    ): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            value: defaultValue,
            validateInput: validator
        });
    }
    
    /**
     * Format error for display
     */
    static formatError(error: unknown): string {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        if (typeof error === 'string') {
            return error;
        }
        return String(error);
    }
    
    /**
     * Set VS Code context variables
     */
    static async setContext(key: string, value: any): Promise<void> {
        await vscode.commands.executeCommand('setContext', key, value);
    }
    
    /**
     * Copy text to clipboard
     */
    static async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
    }
    
    /**
     * Safe JSON parse with error handling
     */
    static safeJsonParse<T>(json: string, defaultValue: T): T {
        try {
            return JSON.parse(json);
        } catch (error) {
            log.warn('Failed to parse JSON:', error);
            return defaultValue;
        }
    }
    
    /**
     * Debounce function calls
     */
    static debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: NodeJS.Timeout;
        return (...args: Parameters<T>) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }
    
    /**
     * Get workspace root path
     */
    static getWorkspaceRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;
    }
    
    /**
     * Validate file extension
     */
    static isFlinkSqlFile(filePath: string): boolean {
        return filePath.endsWith('.flink.sql');
    }
}

/**
 * Base class for TreeDataProvider implementations to reduce code duplication
 */
export abstract class BaseTreeDataProvider<T> implements vscode.TreeDataProvider<T> {
    protected _onDidChangeTreeData: vscode.EventEmitter<T | undefined | null | void> = 
        new vscode.EventEmitter<T | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<T | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    protected refreshing = false;

    constructor(protected readonly context: vscode.ExtensionContext) {
        // Auto-refresh setup if enabled
        this.setupAutoRefresh();
    }

    protected setupAutoRefresh(): void {
        // Override in subclasses if auto-refresh is needed
    }

    refresh(): void {
        if (this.refreshing) {
            return; // Prevent multiple simultaneous refreshes
        }
        
        this.refreshing = true;
        this.loadData()
            .then(() => {
                this._onDidChangeTreeData.fire();
            })
            .catch(error => {
                log.error('Error refreshing tree data:', error);
            })
            .finally(() => {
                this.refreshing = false;
            });
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    // Abstract methods that must be implemented by subclasses
    abstract loadData(): Promise<void>;
    abstract getTreeItem(element: T): vscode.TreeItem;
    abstract getChildren(element?: T): Thenable<T[]>;
}

/**
 * Error handling utilities
 */
export class ErrorHandler {
    /**
     * Handle errors consistently across the extension
     */
    static async handleError(error: unknown, context: string, showToUser: boolean = true): Promise<void> {
        const message = VSCodeUtils.formatError(error);
        log.error(`Error in ${context}: ${message}`);
        
        if (showToUser) {
            await NotificationService.showError(`${context}: ${message}`);
        }
    }
    
    /**
     * Wrap async operations with consistent error handling
     */
    static async withErrorHandling<T>(
        operation: () => Promise<T>,
        context: string,
        showToUser: boolean = true
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            await this.handleError(error, context, showToUser);
            return null;
        }
    }
}
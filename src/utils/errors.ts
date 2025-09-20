import * as vscode from 'vscode';
import { createModuleLogger } from '../services/logger';

const log = createModuleLogger('ErrorHandler');

export function normalizeError(error: unknown): { message: string; stack?: string } {
    if (!error) {
        return { message: 'Unknown error' };
    }
    if (error instanceof Error) {
        return { message: error.message || 'Error', stack: error.stack };
    }
    try {
        return { message: String(error) };
    } catch (e) {
        return { message: 'Unknown error' };
    }
}

export class GlobalErrorHandler {
    private static outputChannel: vscode.OutputChannel | null = null;

    static initialize() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Flink SQL Workbench - Errors');
        }
    }

    static async handleError(error: unknown, context: string, showToUser: boolean = true, userMessage?: string): Promise<void> {
        const normalizedError = normalizeError(error);
        const timestamp = new Date().toISOString();
        
        // Log to our custom logger
        log.error(`${context}: ${normalizedError.message}`, normalizedError.stack);
        
        // Log to output channel
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[${timestamp}] ERROR in ${context}:`);
            this.outputChannel.appendLine(`  Message: ${normalizedError.message}`);
            if (normalizedError.stack) {
                this.outputChannel.appendLine(`  Stack: ${normalizedError.stack}`);
            }
            this.outputChannel.appendLine('');
        }

        // Show to user if requested
        if (showToUser) {
            const displayMessage = userMessage || `Error in ${context}: ${normalizedError.message}`;
            await vscode.window.showErrorMessage(displayMessage, 'Show Logs').then(selection => {
                if (selection === 'Show Logs' && this.outputChannel) {
                    this.outputChannel.show();
                }
            });
        }
    }

    static async withErrorHandling<T>(
        operation: () => Promise<T>,
        context: string,
        showUserMessage: boolean = true,
        userMessage?: string
    ): Promise<T | null> {
        try {
            return await operation();
        } catch (error) {
            await this.handleError(error, context, showUserMessage, userMessage);
            return null;
        }
    }

    static showOutputChannel(): void {
        if (this.outputChannel) {
            this.outputChannel.show();
        }
    }
}

export class UserNotificationService {
    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showInformationMessage(message, ...actions);
    }

    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(message, ...actions);
    }

    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showErrorMessage(message, ...actions);
    }

    static async showProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken) => Promise<T>
    ): Promise<T> {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: true
            },
            task
        );
    }

    static async confirmAction(message: string, actionName: string = 'Confirm'): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            actionName
        );
        return result === actionName;
    }
}

export class ValidationHelper {
    static validateConnectionConfig(config: any): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!config.url) {
            errors.push('URL is required');
        } else if (!this.isValidUrl(config.url)) {
            errors.push('Invalid URL format');
        }

        if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
            errors.push('Timeout must be a positive number');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static validateSessionProperties(properties: Record<string, string>): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Validate common Flink properties
        if (properties['execution.runtime-mode'] && !['streaming', 'batch'].includes(properties['execution.runtime-mode'])) {
            errors.push('execution.runtime-mode must be "streaming" or "batch"');
        }

        if (properties['table.exec.resource.default-parallelism']) {
            const parallelism = parseInt(properties['table.exec.resource.default-parallelism']);
            if (isNaN(parallelism) || parallelism <= 0) {
                errors.push('table.exec.resource.default-parallelism must be a positive integer');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private static isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}

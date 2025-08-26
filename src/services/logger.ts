import * as vscode from 'vscode';

/**
 * Logger utility for the Flink SQL Workbench extension
 * Based on the React implementation but adapted for VS Code
 */

interface LogLevel {
    level: number;
    name: string;
}

const LOG_LEVELS: Record<string, LogLevel> = {
    'error': { level: 0, name: 'ERROR' },
    'warn': { level: 1, name: 'WARN' },
    'info': { level: 2, name: 'INFO' },
    'debug': { level: 3, name: 'DEBUG' },
    'trace': { level: 4, name: 'TRACE' }
};

class Logger {
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;

    constructor(moduleName: string) {
        this.outputChannel = vscode.window.createOutputChannel(`Flink SQL - ${moduleName}`);
        this.logLevel = this.getConfiguredLogLevel();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('flinkSqlWorkbench.logging')) {
                this.logLevel = this.getConfiguredLogLevel();
            }
        });
    }

    private getConfiguredLogLevel(): LogLevel {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.logging');
        const levelName = config.get<string>('level', 'info').toLowerCase();
        return LOG_LEVELS[levelName] || LOG_LEVELS.info;
    }

    private shouldLog(level: LogLevel): boolean {
        return level.level <= this.logLevel.level;
    }

    private formatMessage(level: string, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
        return `[${timestamp}] [${level}] ${message}${dataStr}`;
    }

    private log(level: LogLevel, message: string, data?: any): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level.name, message, data);
        this.outputChannel.appendLine(formattedMessage);

        // Also log to console for development
        switch (level.name) {
            case 'ERROR':
                console.error(formattedMessage);
                break;
            case 'WARN':
                console.warn(formattedMessage);
                break;
            case 'DEBUG':
            case 'TRACE':
                console.debug(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
                break;
        }
    }

    error(message: string, data?: any): void {
        this.log(LOG_LEVELS.error, message, data);
    }

    warn(message: string, data?: any): void {
        this.log(LOG_LEVELS.warn, message, data);
    }

    info(message: string, data?: any): void {
        this.log(LOG_LEVELS.info, message, data);
    }

    debug(message: string, data?: any): void {
        this.log(LOG_LEVELS.debug, message, data);
    }

    trace(message: string, data?: any): void {
        this.log(LOG_LEVELS.trace, message, data);
    }

    traceEnter(methodName: string, params?: any): void {
        this.trace(`ENTER ${methodName}`, params);
    }

    traceExit(methodName: string, result?: any): void {
        this.trace(`EXIT ${methodName}`, result);
    }

    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

// Module logger factory
const moduleLoggers = new Map<string, Logger>();

export function createModuleLogger(moduleName: string): Logger {
    if (!moduleLoggers.has(moduleName)) {
        moduleLoggers.set(moduleName, new Logger(moduleName));
    }
    return moduleLoggers.get(moduleName)!;
}

export function getModuleLogger(moduleName: string): Logger {
    return createModuleLogger(moduleName);
}

// Default logger
export const logger = createModuleLogger('Main');

export default logger;

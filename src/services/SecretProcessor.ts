import * as vscode from 'vscode';
import { createModuleLogger } from './logger';

const log = createModuleLogger('SecretProcessor');

export class SecretProcessingError extends Error {
    constructor(message: string, public readonly cause?: Error) {
        super(message);
        this.name = 'SecretProcessingError';
    }
}

/**
 * SecretProcessor - Processes secret placeholders in SQL statements for local development
 * Replaces Kubernetes secret references with environment variable values
 * Format: ${secrets://namespace:secretname/key} -> process.env[key]
 */
export class SecretProcessor {
    private static readonly SECRET_PATTERN = /\$\{secrets:\/\/([^:]+):([^/]+)\/([^}]+)\}/g;

    /**
     * Process a SQL statement and replace all secret placeholders with environment variable values
     * Format: ${secrets://namespace:secretname/key} -> process.env[key]
     * 
     * @param statement SQL statement containing secret placeholders
     * @returns SQL statement with resolved environment variable values
     * @throws SecretProcessingError if secret resolution fails
     */
    public static processStatement(statement: string): string {
        if (!statement || statement.trim().length === 0) {
            return statement;
        }

        try {
            let processedStatement = statement;
            let hasReplacements = false;
            const replacements: Array<{original: string, key: string, value: string}> = [];

            // Replace all secret placeholders
            processedStatement = statement.replace(
                SecretProcessor.SECRET_PATTERN, 
                (match, namespace, secretName, key) => {
                    const envValue = process.env[key];
                    
                    if (envValue === undefined) {
                        const errorMsg = `Environment variable '${key}' not found for secret reference: ${match}`;
                        log.error(errorMsg);
                        throw new SecretProcessingError(errorMsg);
                    }

                    hasReplacements = true;
                    replacements.push({
                        original: match,
                        key: key,
                        value: envValue
                    });

                    log.debug(`Replacing secret reference ${match} with environment variable ${key}`);
                    return envValue;
                }
            );

            if (hasReplacements) {
                log.info(`Processed ${replacements.length} secret reference(s) in SQL statement`);
                for (const replacement of replacements) {
                    log.debug(`  ${replacement.original} -> ${replacement.key}=${replacement.value.substring(0, 4)}****`);
                }
            }

            return processedStatement;

        } catch (error: any) {
            if (error instanceof SecretProcessingError) {
                throw error;
            }
            throw new SecretProcessingError(`Error processing secrets in SQL statement: ${error.message}`, error);
        }
    }

    /**
     * Extract all secret references from a SQL statement without processing them
     * Useful for validation or preview purposes
     * 
     * @param statement SQL statement to analyze
     * @returns Array of secret references found
     */
    public static extractSecretReferences(statement: string): Array<{
        fullMatch: string;
        namespace: string;
        secretName: string;
        key: string;
    }> {
        if (!statement || statement.trim().length === 0) {
            return [];
        }

        const references: Array<{
            fullMatch: string;
            namespace: string;
            secretName: string;
            key: string;
        }> = [];

        let match;
        const regex = new RegExp(SecretProcessor.SECRET_PATTERN.source, 'g');
        
        while ((match = regex.exec(statement)) !== null) {
            references.push({
                fullMatch: match[0],
                namespace: match[1],
                secretName: match[2],
                key: match[3]
            });
        }

        return references;
    }

    /**
     * Validate that all secret references in a statement can be resolved
     * 
     * @param statement SQL statement to validate
     * @returns Object containing validation result and any missing environment variables
     */
    public static validateStatement(statement: string): {
        isValid: boolean;
        missingEnvVars: string[];
        secretReferences: Array<{fullMatch: string, namespace: string, secretName: string, key: string}>;
    } {
        const secretReferences = SecretProcessor.extractSecretReferences(statement);
        const missingEnvVars: string[] = [];

        for (const ref of secretReferences) {
            if (process.env[ref.key] === undefined) {
                missingEnvVars.push(ref.key);
            }
        }

        return {
            isValid: missingEnvVars.length === 0,
            missingEnvVars,
            secretReferences
        };
    }

    /**
     * Enable secret processing based on VS Code configuration
     */
    public static isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.secrets');
        return config.get<boolean>('enableSecretProcessing', true);
    }

    /**
     * Check if validation before execution is enabled
     */
    public static isValidationEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.secrets');
        return config.get<boolean>('validateBeforeExecution', true);
    }
}

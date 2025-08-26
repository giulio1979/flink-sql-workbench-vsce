import * as vscode from 'vscode';
import { createModuleLogger } from './logger';

const log = createModuleLogger('FlinkApiService');

export interface GatewayCredentials {
    username?: string;
    password?: string;
    apiToken?: string;
}

export interface ConnectionConfig {
    url: string;
    useProxy: boolean;
    apiVersion: string;
    timeout: number;
    maxRetries: number;
    credentials?: GatewayCredentials;
}

/**
 * FlinkApiService - Direct implementation of Flink SQL Gateway REST API
 * Based on the proven React implementation with full API compliance
 */
export class FlinkApiService {
    private baseUrl: string;
    private apiVersion: string = 'v1';
    private useProxy: boolean = false;
    private credentials: GatewayCredentials | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(baseUrl: string = '/api/flink') {
        log.traceEnter('constructor', { baseUrl });
        
        this.baseUrl = baseUrl;
        this.outputChannel = vscode.window.createOutputChannel('Flink API Service');
        this.setBaseUrl(baseUrl);
        
        log.traceExit('constructor');
    }

    setBaseUrl(url: string): void {
        log.traceEnter('setBaseUrl', { url });
        
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        
        // Use proxy for:
        // 1. URLs that start with /api/flink (explicit proxy)
        // 2. External URLs (not localhost) to avoid CORS issues
        this.useProxy = url.startsWith('/api/flink') || 
                       (!url.includes('localhost') && (url.startsWith('http://') || url.startsWith('https://')));
        
        log.info('setBaseUrl', `Base URL: ${this.baseUrl} (proxy: ${this.useProxy})`);
        log.traceExit('setBaseUrl');
    }

    setCredentials(username?: string, password?: string, apiToken?: string): void {
        log.traceEnter('setCredentials', { username: username ? '***' : '', hasPassword: !!password, hasApiToken: !!apiToken });
        this.credentials = { username, password, apiToken };
        log.traceExit('setCredentials');
    }

    private getProxyUrl(endpoint: string): string {
        if (this.useProxy) {
            // If baseUrl is already a proxy path, use it directly
            if (this.baseUrl.startsWith('/api/flink')) {
                return `${this.baseUrl}${endpoint}`;
            }
            return `/api/flink${endpoint}`;
        }
        return `${this.baseUrl}${endpoint}`;
    }

    async request(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = this.getProxyUrl(endpoint);
        
        log.info('request', `Making request to: ${url} (using ${this.useProxy ? 'proxy' : 'direct'} connection)`);
        
        // Prepare headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        // Add authentication headers if credentials are available
        if (this.credentials) {
            if (this.credentials.apiToken) {
                // Use Bearer token if available
                headers['Authorization'] = `Bearer ${this.credentials.apiToken}`;
            } else if (this.credentials.username && this.credentials.password) {
                // Use basic authentication
                const encoded = Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64');
                headers['Authorization'] = `Basic ${encoded}`;
            }
        }
        
        const config: RequestInit = {
            headers,
            ...options,
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const errorText = await response.text();
                log.error('request', `HTTP error! status: ${response.status}, body: ${errorText}`);
                
                // Try to parse error as JSON for better error details
                let errorDetails = null;
                let processedErrorMessage = errorText;
                
                try {
                    errorDetails = JSON.parse(errorText);
                    log.error('request', `Parsed error details: ${JSON.stringify(errorDetails)}`);
                    
                    // Extract root cause from Java exception if present
                    const rootCause = this.extractRootCause(errorDetails.errors);
                    if (rootCause) {
                        processedErrorMessage = rootCause;
                    }
                } catch (parseError) {
                    // Use original error text if parsing fails
                }
                
                throw new Error(`HTTP error! status: ${response.status} - ${processedErrorMessage}`);
            }
            
            const data = await response.json();
            return data;
        } catch (error: any) {
            log.error('request', `Flink API request failed: ${error.message}`);
            log.error('request', `Request details: ${options.method || 'GET'} ${endpoint}`);
            log.error('request', `URL used: ${url}`);
            log.error('request', `Connection mode: ${this.useProxy ? 'proxy' : 'direct'}`);
            
            // Check if it's a CORS error
            if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
                log.error('request', 'This looks like a CORS/Network error. Possible solutions:');
                
                if (!this.useProxy) {
                    log.error('request', '1. Enable proxy mode in VS Code settings');
                    log.error('request', '2. Configure CORS on your Flink cluster');
                    log.error('request', '3. Use a reverse proxy');
                } else {
                    log.error('request', '1. Check if the VS Code proxy extension is running');
                    log.error('request', '2. Verify Flink Gateway is accessible');
                    log.error('request', '3. Check firewall/network settings');
                }
                
                log.error('request', '4. Check browser network tab for more details');
            }
            
            throw error;
        }
    }

    // Get Flink info and auto-detect API version
    async getInfo(): Promise<any> {
        log.traceEnter('getInfo');
        
        try {
            // Try v1 first
            const result = await this.request('/v1/info');
            this.apiVersion = 'v1';
            log.info('getInfo', 'Using Flink API v1');
            log.traceExit('getInfo', result);
            return result;
        } catch (error) {
            try {
                const result = await this.request('/v2/info');
                this.apiVersion = 'v2';
                log.info('getInfo', 'Using Flink API v2');
                log.traceExit('getInfo', result);
                return result;
            } catch (error2: any) {
                log.error('getInfo', `Both API v1 and v2 failed: ${error2.message}`);
                throw error2;
            }
        }
    }

    // Create a new session
    async createSession(properties: Record<string, string> = {}): Promise<any> {
        log.traceEnter('createSession', { properties });
        
        const endpoint = `/${this.apiVersion}/sessions`;
        log.info('createSession', 'Creating session');
        
        // Flink SQL Gateway expects properties to be wrapped in a "properties" field
        const requestBody = {
            properties: properties
        };
        
        const response = await this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestBody),
        });
        
        log.info('createSession', `Session created: ${response.sessionHandle}`);
        log.traceExit('createSession', response);
        return response;
    }

    // Get session info
    async getSession(sessionHandle: string): Promise<any> {
        log.traceEnter('getSession', { sessionHandle });
        
        const endpoint = `/${this.apiVersion}/sessions/${sessionHandle}`;
        const response = await this.request(endpoint);
        
        log.traceExit('getSession', response);
        return response;
    }

    // Close a session
    async closeSession(sessionHandle: string): Promise<any> {
        log.traceEnter('closeSession', { sessionHandle });
        
        const endpoint = `/${this.apiVersion}/sessions/${sessionHandle}`;
        log.info('closeSession', `Closing session: ${sessionHandle}`);
        
        const response = await this.request(endpoint, {
            method: 'DELETE',
        });
        
        log.info('closeSession', 'Session closed');
        log.traceExit('closeSession', response);
        return response;
    }

    // Submit a SQL statement
    async submitStatement(sessionHandle: string, statement: string): Promise<any> {
        log.traceEnter('submitStatement', { sessionHandle, statementLength: statement.length });
        
        const endpoint = `/${this.apiVersion}/sessions/${sessionHandle}/statements`;
        const truncatedStatement = statement.length > 100 ? `${statement.substring(0, 100)}...` : statement;
        log.info('submitStatement', `Executing SQL: ${truncatedStatement}`);
        
        const response = await this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify({ statement }),
        });
        
        log.info('submitStatement', `Statement submitted: ${response.operationHandle}`);
        log.traceExit('submitStatement', response);
        return response;
    }

    // Get operation status
    async getOperationStatus(sessionHandle: string, operationHandle: string): Promise<any> {
        log.trace('getOperationStatus', `Checking status for operation: ${operationHandle}`);
        
        const endpoint = `/${this.apiVersion}/sessions/${sessionHandle}/operations/${operationHandle}/status`;
        
        const response = await this.request(endpoint);
        
        // Only log status changes or errors, not every poll
        if (response.status === 'ERROR') {
            log.error('getOperationStatus', `Operation failed: ${operationHandle}`);
            
            // Look for error details in various possible locations
            if (response.errorMessage) {
                log.error(`Error: ${response.errorMessage}`);
            }
            if (response.exception) {
                log.error('Exception in operation status', response.exception);
            }
        } else if (response.status === 'FINISHED') {
            log.info('getOperationStatus', `Operation completed: ${operationHandle}`);
        }
        
        return response;
    }

    // Get operation results
    async getOperationResults(sessionHandle: string, operationHandle: string, token: number = 0, rowFormat: string = 'JSON'): Promise<any> {
        const endpoint = `/${this.apiVersion}/sessions/${sessionHandle}/operations/${operationHandle}/result/${token}?rowFormat=${rowFormat}`;
        
        const response = await this.request(endpoint);
        
        // Only log significant events, not every token fetch
        if (token === 0) {
            log.debug(`Fetching results for operation: ${operationHandle}`);
        }
        
        // If there are errors in the results, log them
        if (response.errors && Array.isArray(response.errors) && response.errors.length > 0) {
            log.error('Errors in operation results', { 
                operationHandle,
                errors: response.errors 
            });
        }
        
        return response;
    }

    // Get detailed error information for a failed operation
    async getOperationError(sessionHandle: string, operationHandle: string): Promise<any> {
        try {
            // First try to get the status with error details
            const statusResponse = await this.getOperationStatus(sessionHandle, operationHandle);
            
            // Then try to get result with error details
            const resultResponse = await this.getOperationResults(sessionHandle, operationHandle, 0);
            
            const errorInfo = {
                status: statusResponse,
                result: resultResponse,
                extractedErrors: [] as any[]
            };
            
            // Extract errors from various sources
            if (statusResponse.errorMessage) {
                errorInfo.extractedErrors.push({
                    source: 'status.errorMessage',
                    message: statusResponse.errorMessage
                });
            }
            
            if (statusResponse.exception) {
                errorInfo.extractedErrors.push({
                    source: 'status.exception',
                    details: statusResponse.exception
                });
            }
            
            if (resultResponse.errors) {
                errorInfo.extractedErrors.push({
                    source: 'result.errors',
                    errors: resultResponse.errors
                });
            }
            
            return errorInfo;
        } catch (error: any) {
            log.error(`Failed to get detailed error information: ${error.message}`, {
                error: error.stack,
                operationHandle
            });
            throw error;
        }
    }

    // Get all results for an operation (handles pagination)
    async getAllResults(sessionHandle: string, operationHandle: string): Promise<{ results: any[], columns: any[] }> {
        log.debug(`Fetching all results for operation: ${operationHandle}`);
        const results: any[] = [];
        let nextToken = 0;
        let hasMore = true;
        let columns: any[] = [];
        let attempts = 0;
        const maxAttempts = 10; // Prevent infinite loops

        while (hasMore && attempts < maxAttempts) {
            attempts++;
            
            try {
                const response = await this.getOperationResults(sessionHandle, operationHandle, nextToken);
                
                // Extract and handle result metadata
                const resultType = response.resultType;
                const resultKind = response.resultKind;
                
                // Handle different column sources - prioritize columnInfos over columns
                if (response.results) {
                    if (response.results.columnInfos && response.results.columnInfos.length > 0 && columns.length === 0) {
                        columns = response.results.columnInfos;
                    } else if (response.results.columns && response.results.columns.length > 0 && columns.length === 0) {
                        columns = response.results.columns;
                    }
                    
                    // Handle result data - check multiple possible locations
                    let dataToAdd = null;
                    if (response.results.data && Array.isArray(response.results.data)) {
                        dataToAdd = response.results.data;
                    } else if (response.data && Array.isArray(response.data)) {
                        dataToAdd = response.data;
                    }
                    
                    if (dataToAdd && dataToAdd.length > 0) {
                        results.push(...dataToAdd);
                    }
                }

                // Check if there are more results
                if (response.nextResultUri) {
                    // Extract token from nextResultUri
                    const tokenMatch = response.nextResultUri.match(/result\/(\d+)/);
                    if (tokenMatch) {
                        nextToken = parseInt(tokenMatch[1]);
                    } else {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }

                // Handle different result types
                if (response.resultType === 'EOS') {
                    hasMore = false;
                } else if (response.resultType === 'NOT_READY') {
                    // Wait a bit before retrying
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else if (response.resultType === 'PAYLOAD') {
                    // Continue with next token
                }
                
                // Special handling for empty first response
                if (response.resultType === 'EOS' && 
                    (!response.results || !response.results.data || response.results.data.length === 0) && 
                    !response.nextResultUri && 
                    nextToken === 0 && 
                    attempts === 1) {
                    nextToken = 1;
                    hasMore = true;
                }
                
            } catch (error: any) {
                log.error(`Error fetching results at token ${nextToken}: ${error.message}`, { 
                    operationHandle 
                });
                throw error; // Re-throw to maintain error propagation
            }
        }

        if (attempts >= maxAttempts) {
            log.warn(`Stopped after max attempts (${maxAttempts}) to prevent infinite loop`);
        }

        log.info(`Retrieved ${results.length} rows with ${columns.length} columns for operation ${operationHandle}`);

        return { results, columns };
    }

    // Extract root cause from Java exception stack trace
    private extractRootCause(errors: any[]): string | null {
        if (!errors || !Array.isArray(errors)) return null;
        
        // Look for the error message that contains the full stack trace
        const stackTraceError = errors.find(error => 
            typeof error === 'string' && error.includes('Caused by:')
        );
        
        if (!stackTraceError) return null;
        
        // Split by "Caused by:" and get the last one
        const causedByParts = stackTraceError.split('Caused by:');
        if (causedByParts.length <= 1) return null;
        
        // Get the last "Caused by:" section
        const rootCauseSection = causedByParts[causedByParts.length - 1].trim();
        
        // Extract just the exception type and message (first line)
        const lines = rootCauseSection.split('\n');
        const rootCauseLine = lines[0].trim();
        
        // Clean up the root cause message
        if (rootCauseLine) {
            // Remove common Java exception prefixes to make it more readable
            const cleanMessage = rootCauseLine
                .replace(/^[a-zA-Z0-9.]+Exception:\s*/, '') // Remove exception class name
                .replace(/^[a-zA-Z0-9.]+Error:\s*/, '') // Remove error class name
                .trim();
            
            return cleanMessage || rootCauseLine;
        }
        
        return null;
    }

    showOutput(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

export const flinkApiInstance = new FlinkApiService();

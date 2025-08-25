import * as vscode from 'vscode';

export interface QueryResult {
    columns: Array<{
        name: string;
        logicalType: {
            type: string;
            nullable: boolean;
        };
    }>;
    results: any[];
    executionTime: number;
    affectedRows?: number;
    error?: string;
}

export interface SessionInfo {
    sessionHandle: string;
    sessionName: string;
    created: Date;
}

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

export class FlinkGatewayService {
    private config: ConnectionConfig;
    private sessionHandle: string | null = null;
    private sessionName: string = '';
    private outputChannel: vscode.OutputChannel;
    private sessionRefreshCallback?: () => void;
    private connected: boolean = false;
    private keepAliveTimer?: NodeJS.Timeout;
    private autoReconnect: boolean = true;
    private detectedApiVersion: string = 'v1';

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Flink SQL Gateway');
        this.config = this.loadConfiguration();
        this.startKeepAlive();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('flinkSqlWorkbench.gateway') || 
                e.affectsConfiguration('flinkSqlWorkbench.session')) {
                this.loadConfiguration();
            }
        });
    }

    private loadConfiguration(): ConnectionConfig {
        const gatewayConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.gateway');
        const sessionConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.session');
        
        // Build URL - prefer gateway.url over legacy host/port
        let url = gatewayConfig.get<string>('url', '');
        if (!url) {
            const host = gatewayConfig.get<string>('host', 'localhost');
            const port = gatewayConfig.get<number>('port', 8083);
            url = `http://${host}:${port}`;
        }
        
        // Remove trailing slash
        url = url.endsWith('/') ? url.slice(0, -1) : url;

        // Get credentials
        const credentials: GatewayCredentials = {
            username: gatewayConfig.get<string>('authentication.username', ''),
            password: gatewayConfig.get<string>('authentication.password', ''),
            apiToken: gatewayConfig.get<string>('authentication.apiToken', '')
        };

        // Clean up empty credentials
        if (!credentials.username) delete credentials.username;
        if (!credentials.password) delete credentials.password;
        if (!credentials.apiToken) delete credentials.apiToken;

        this.config = {
            url,
            useProxy: gatewayConfig.get<boolean>('useProxy', false),
            apiVersion: gatewayConfig.get<string>('apiVersion', 'auto'),
            timeout: gatewayConfig.get<number>('timeout', 30000),
            maxRetries: gatewayConfig.get<number>('maxRetries', 3),
            credentials: Object.keys(credentials).length > 0 ? credentials : undefined
        };

        this.sessionName = gatewayConfig.get<string>('sessionName', 'vscode-session');
        this.autoReconnect = sessionConfig.get<boolean>('autoReconnect', true);

        this.logInfo(`Configuration updated: ${this.config.url} (proxy: ${this.config.useProxy})`);
        if (this.config.credentials) {
            this.logInfo(`Authentication configured: ${this.config.credentials.apiToken ? 'Bearer Token' : 'Basic Auth'}`);
        }

        return this.config;
    }

    private startKeepAlive(): void {
        const sessionConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.session');
        const keepAliveInterval = sessionConfig.get<number>('keepAliveInterval', 300000); // 5 minutes
        
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
        }

        this.keepAliveTimer = setInterval(async () => {
            if (this.connected && this.sessionHandle) {
                try {
                    await this.getSessionInfo();
                    this.logDebug('Keep-alive successful');
                } catch (error) {
                    this.logError('Keep-alive failed', error);
                    if (this.autoReconnect) {
                        this.logInfo('Attempting to reconnect...');
                        await this.connect();
                    }
                }
            }
        }, keepAliveInterval);
    }

    setSessionRefreshCallback(callback: () => void): void {
        this.sessionRefreshCallback = callback;
    }

    private notifySessionChanged(): void {
        if (this.sessionRefreshCallback) {
            this.sessionRefreshCallback();
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    // Build the appropriate URL based on proxy settings
    private getRequestUrl(endpoint: string): string {
        if (this.config.useProxy) {
            // If using proxy, use relative URL
            return `/api/flink${endpoint}`;
        } else {
            // Direct connection to gateway
            return `${this.config.url}${endpoint}`;
        }
    }

    // Auto-detect API version
    private async detectApiVersion(): Promise<string> {
        if (this.config.apiVersion !== 'auto') {
            this.detectedApiVersion = this.config.apiVersion;
            return this.config.apiVersion;
        }

        // Try v1 first (most common)
        try {
            await this.makeRequest('/v1/info', { method: 'GET' });
            this.logInfo('Auto-detected API version: v1');
            this.detectedApiVersion = 'v1';
            return 'v1';
        } catch (error) {
            // Try v2
            try {
                await this.makeRequest('/v2/info', { method: 'GET' });
                this.logInfo('Auto-detected API version: v2');
                this.detectedApiVersion = 'v2';
                return 'v2';
            } catch (error2) {
                this.logWarn('Could not auto-detect API version, defaulting to v1');
                this.detectedApiVersion = 'v1';
                return 'v1';
            }
        }
    }

    private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = this.getRequestUrl(endpoint);
        const networkLogging = vscode.workspace.getConfiguration('flinkSqlWorkbench.logging')
            .get<boolean>('enableNetworkLogging', false);

        // Prepare headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        // Add authentication headers
        if (this.config.credentials) {
            if (this.config.credentials.apiToken) {
                headers['Authorization'] = `Bearer ${this.config.credentials.apiToken}`;
            } else if (this.config.credentials.username && this.config.credentials.password) {
                const encoded = Buffer.from(`${this.config.credentials.username}:${this.config.credentials.password}`).toString('base64');
                headers['Authorization'] = `Basic ${encoded}`;
            }
        }

        const requestConfig: RequestInit = {
            ...options,
            headers,
        };

        if (networkLogging) {
            this.logDebug(`Making request: ${options.method || 'GET'} ${url}`);
            this.logDebug(`Headers: ${JSON.stringify(headers, null, 2)}`);
            if (options.body) {
                this.logDebug(`Body: ${options.body}`);
            }
        }

        let lastError: Error | null = null;
        
        // Retry logic
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

                const response = await fetch(url, {
                    ...requestConfig,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (networkLogging) {
                    this.logDebug(`Response: ${response.status} ${response.statusText}`);
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    
                    // Try to parse error details
                    try {
                        const errorData = JSON.parse(errorText);
                        if (errorData.errors && Array.isArray(errorData.errors)) {
                            const rootCause = this.extractRootCause(errorData.errors);
                            if (rootCause) {
                                errorMessage = rootCause;
                            }
                        } else if (errorData.message) {
                            errorMessage = errorData.message;
                        }
                    } catch {
                        // Use original error text if parsing fails
                        if (errorText) {
                            errorMessage = errorText;
                        }
                    }

                    throw new Error(errorMessage);
                }

                const data = await response.json();
                
                if (networkLogging) {
                    this.logDebug(`Response data: ${JSON.stringify(data, null, 2)}`);
                }

                return data;

            } catch (error: any) {
                lastError = error;
                
                if (attempt < this.config.maxRetries) {
                    this.logWarn(`Request attempt ${attempt} failed, retrying... ${error.message}`);
                    // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                } else {
                    this.logError(`All ${this.config.maxRetries} request attempts failed`, error);
                }
            }
        }

        throw lastError || new Error('Request failed after all retries');
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

    async connect(): Promise<SessionInfo | null> {
        this.logInfo(`Connecting to Flink Gateway at ${this.config.url}`);
        
        try {
            // Auto-detect API version first
            const apiVersion = await this.detectApiVersion();
            
            // Get session properties from configuration
            const sessionConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.session');
            const sessionProperties = sessionConfig.get<Record<string, string>>('properties', {
                'execution.runtime-mode': 'streaming',
                'table.exec.resource.default-parallelism': '1',
                'execution.checkpointing.interval': '10s'
            });

            const response = await this.makeRequest(`/${apiVersion}/sessions`, {
                method: 'POST',
                body: JSON.stringify({
                    sessionName: this.sessionName,
                    properties: sessionProperties
                })
            });

            if (response.sessionHandle) {
                this.sessionHandle = response.sessionHandle;
                this.connected = true;
                this.logInfo(`Connected successfully. Session created: ${this.sessionName} (${response.sessionHandle})`);
                this.notifySessionChanged();
                return {
                    sessionHandle: response.sessionHandle,
                    sessionName: this.sessionName,
                    created: new Date()
                };
            } else {
                this.logError('Failed to create session: No session handle returned');
                return null;
            }
        } catch (error) {
            this.logError('Connection failed', error);
            this.connected = false;
            return null;
        }
    }

    async disconnect(): Promise<void> {
        if (this.sessionHandle) {
            this.logInfo(`Disconnecting from session: ${this.sessionName} (${this.sessionHandle})`);
            try {
                await this.makeRequest(`/${this.detectedApiVersion}/sessions/${this.sessionHandle}`, {
                    method: 'DELETE'
                });
                this.logInfo('Disconnected successfully');
            } catch (error) {
                this.logError('Error disconnecting session', error);
            } finally {
                this.sessionHandle = null;
                this.connected = false;
                this.notifySessionChanged();
            }
        }
    }

    async getSessionInfo(): Promise<SessionInfo | null> {
        if (!this.sessionHandle) {
            return null;
        }

        try {
            const response = await this.makeRequest(`/${this.detectedApiVersion}/sessions/${this.sessionHandle}`);
            return {
                sessionHandle: this.sessionHandle,
                sessionName: this.sessionName,
                created: new Date(response.sessionInfo?.createTime || Date.now())
            };
        } catch (error) {
            this.logError('Failed to get session info', error);
            return null;
        }
    }

    async executeQuery(sql: string): Promise<QueryResult | null> {
        if (!this.sessionHandle) {
            this.logInfo('No active session, attempting to connect...');
            try {
                await this.connect();
            } catch (error) {
                this.logError('Failed to auto-connect for query execution', error);
                return null;
            }
        }

        if (!this.sessionHandle) {
            const errorMsg = 'No active session. Please connect to the gateway first.';
            this.logError(errorMsg);
            return null;
        }

        const startTime = Date.now();
        this.logInfo(`Executing query: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);

        try {
            // Submit the statement
            const submitResponse = await this.makeRequest(`/${this.detectedApiVersion}/sessions/${this.sessionHandle}/statements`, {
                method: 'POST',
                body: JSON.stringify({
                    statement: sql
                })
            });

            const operationHandle = submitResponse.operationHandle;
            this.logInfo(`Query submitted with operation handle: ${operationHandle}`);
            
            // Get all results using pagination
            const results = await this.getAllResults(this.sessionHandle, operationHandle);
            const executionTime = Date.now() - startTime;

            this.logInfo(`Query completed in ${executionTime}ms. Results: ${results.results.length} rows, ${results.columns.length} columns`);

            return {
                columns: results.columns,
                results: results.results,
                executionTime,
                affectedRows: results.results.length
            };

        } catch (error) {
            this.logError('Query execution failed', error);
            return {
                columns: [],
                results: [],
                executionTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // Get all results for an operation (handles pagination)
    private async getAllResults(sessionHandle: string, operationHandle: string): Promise<{ results: any[], columns: any[] }> {
        this.logDebug(`Fetching all results for operation: ${operationHandle}`);
        const results: any[] = [];
        let nextToken = 0;
        let hasMore = true;
        let columns: any[] = [];
        let attempts = 0;
        const maxAttempts = 10; // Prevent infinite loops

        while (hasMore && attempts < maxAttempts) {
            attempts++;
            
            try {
                const response = await this.makeRequest(`/${this.detectedApiVersion}/sessions/${sessionHandle}/operations/${operationHandle}/result/${nextToken}`);
                
                // Handle different column sources - prioritize columnInfos over columns
                if (response.results) {
                    if (response.results.columnInfos && response.results.columnInfos.length > 0 && columns.length === 0) {
                        columns = response.results.columnInfos;
                        this.logDebug(`Found columns from columnInfos: ${columns.length}`);
                    } else if (response.results.columns && response.results.columns.length > 0 && columns.length === 0) {
                        columns = response.results.columns;
                        this.logDebug(`Found columns from columns: ${columns.length}`);
                    }
                    
                    // Handle result data - check multiple possible locations
                    let dataToAdd: any[] | null = null;
                    if (response.results.data && Array.isArray(response.results.data)) {
                        dataToAdd = response.results.data;
                    } else if (Array.isArray(response.results)) {
                        dataToAdd = response.results;
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
                        const newToken = parseInt(tokenMatch[1]);
                        if (newToken > nextToken) {
                            nextToken = newToken;
                        } else {
                            hasMore = false;
                        }
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
                    // Continue to next iteration
                } else if (response.resultType === 'PAYLOAD') {
                    // Continue based on nextResultUri presence
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
                
            } catch (error) {
                this.logError(`Error fetching results`, error);
                throw error;
            }
        }

        if (attempts >= maxAttempts) {
            this.logWarn(`Stopped after max attempts to prevent infinite loop: ${maxAttempts}`);
        }

        this.logInfo(`Retrieved results: ${results.length} rows, ${columns.length} columns`);

        return { results, columns };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private logInfo(message: string): void {
        console.log(`[FlinkGatewayService] ${message}`);
        this.outputChannel.appendLine(`[INFO] ${message}`);
    }

    private logError(message: string, error?: any): void {
        const errorMsg = error ? ` - ${error.message || error}` : '';
        console.error(`[FlinkGatewayService] ${message}${errorMsg}`);
        this.outputChannel.appendLine(`[ERROR] ${message}${errorMsg}`);
        if (error && error.stack) {
            this.outputChannel.appendLine(`[ERROR] Stack: ${error.stack}`);
        }
    }

    private logWarn(message: string): void {
        console.warn(`[FlinkGatewayService] ${message}`);
        this.outputChannel.appendLine(`[WARN] ${message}`);
    }

    private logDebug(message: string): void {
        const loggingConfig = vscode.workspace.getConfiguration('flinkSqlWorkbench.logging');
        const logLevel = loggingConfig.get<string>('level', 'info');
        
        if (logLevel === 'debug' || logLevel === 'trace') {
            console.debug(`[FlinkGatewayService] ${message}`);
            this.outputChannel.appendLine(`[DEBUG] ${message}`);
        }
    }

    // Additional utility methods for catalog and jobs
    async executeCatalogQuery(sql: string): Promise<any> {
        try {
            const result = await this.executeQuery(sql);
            return result;
        } catch (error) {
            this.logError(`Catalog query failed: ${sql}`, error);
            return null;
        }
    }

    // Methods for compatibility with existing providers
    showOutput(): void {
        this.outputChannel.show();
    }

    getCurrentSession(): SessionInfo | null {
        if (this.sessionHandle) {
            return {
                sessionHandle: this.sessionHandle,
                sessionName: this.sessionName,
                created: new Date()
            };
        }
        return null;
    }

    async createNewSession(): Promise<SessionInfo | null> {
        return await this.connect();
    }

    async deleteCurrentSession(): Promise<void> {
        await this.disconnect();
    }

    async getSessionDetails(): Promise<SessionInfo | null> {
        return await this.getSessionInfo();
    }

    // Dispose method for cleanup
    dispose(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
        }
        this.outputChannel.dispose();
    }
}

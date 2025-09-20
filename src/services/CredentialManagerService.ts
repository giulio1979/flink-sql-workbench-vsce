import * as vscode from 'vscode';
import { GatewayCredentials } from './FlinkApiService';
import { createModuleLogger } from './logger';

const log = createModuleLogger('CredentialManagerService');

interface CredentialManagerAPI {
  getCredential: (key: string) => Promise<string | undefined>;
  setCredential: (key: string, value: string) => Promise<void>;
  deleteCredential: (key: string) => Promise<void>;
  listCredentials: () => Promise<string[]>;
}

export interface CredentialConnection {
    id: string;
    name: string;
    type: string;
    url: string;
    authType: string;
    username?: string;
    password?: string;
    apiToken?: string;
}

/**
 * CredentialManagerService - Integrates with external credential manager extension
 * Retrieves connection details and credentials from the credential manager
 */
export class CredentialManagerService {
    private static instance: CredentialManagerService;
    private static extensionContext: vscode.ExtensionContext | null = null;
    private credentialManagerAPI: CredentialManagerAPI | null = null;

    private constructor() {}

    public static getInstance(): CredentialManagerService {
        if (!CredentialManagerService.instance) {
            CredentialManagerService.instance = new CredentialManagerService();
        }
        return CredentialManagerService.instance;
    }

    /**
     * Initialize the service with extension context
     */
    public static initialize(context: vscode.ExtensionContext): void {
        CredentialManagerService.extensionContext = context;
    }
    
    /**
     * Ensures that the credential manager extension is active
     * This can be called before attempting to use the extension's API
     */
    public static async ensureCredentialManagerExtensionActive(): Promise<boolean> {
        try {
            const credentialManagerExtension = vscode.extensions.getExtension('IuliusHutuleac.credential-manager');
            if (!credentialManagerExtension) {
                log.warn('Credential Manager extension not found');
                return false;
            }
            
            if (!credentialManagerExtension.isActive) {
                log.info('Activating Credential Manager extension...');
                await credentialManagerExtension.activate();
                log.info('Credential Manager extension activated successfully');
            } else {
                log.info('Credential Manager extension is already active');
            }
            
            return true;
        } catch (error) {
            log.error('Failed to activate Credential Manager extension:', error);
            return false;
        }
    }

    public async initializeCredentialAPI(): Promise<void> {
        try {
            // Try to get the credential manager extension
            const credentialManagerExtension = vscode.extensions.getExtension('IuliusHutuleac.credential-manager');
            
            if (!credentialManagerExtension) {
                throw new Error('Credential Manager extension not found. Please install the credential-manager extension.');
            }

            if (!credentialManagerExtension.isActive) {
                await credentialManagerExtension.activate();
            }

            this.credentialManagerAPI = credentialManagerExtension.exports;
            
            if (!this.credentialManagerAPI || typeof this.credentialManagerAPI.getCredential !== 'function') {
                throw new Error('Credential Manager API not available or incompatible');
            }
        } catch (error) {
            console.error('Failed to initialize credential manager:', error);
            throw error;
        }
    }

    public async getCredential(key: string): Promise<string | undefined> {
        if (!this.credentialManagerAPI) {
            await this.initializeCredentialAPI();
        }
        return this.credentialManagerAPI!.getCredential(key);
    }

    public async setCredential(key: string, value: string): Promise<void> {
        if (!this.credentialManagerAPI) {
            await this.initializeCredentialAPI();
        }
        return this.credentialManagerAPI!.setCredential(key, value);
    }

    public async deleteCredential(key: string): Promise<void> {
        if (!this.credentialManagerAPI) {
            await this.initializeCredentialAPI();
        }
        return this.credentialManagerAPI!.deleteCredential(key);
    }

    public async listCredentials(): Promise<string[]> {
        if (!this.credentialManagerAPI) {
            await this.initializeCredentialAPI();
        }
        return this.credentialManagerAPI!.listCredentials();
    }

    public isInitialized(): boolean {
        return this.credentialManagerAPI !== null;
    }
    
    /**
     * Get connection details from credential manager by connection ID
     */
    public static async getConnectionById(connectionId: string): Promise<CredentialConnection | null> {
        log.traceEnter('getConnectionById', { connectionId });
        
        try {
            // Get the credential manager connections from workspace configuration
            const config = vscode.workspace.getConfiguration();
            const connections = config.get<CredentialConnection[]>('credentialManager.connections', []);
            
            log.info(`Found ${connections.length} connections in credential manager`);
            
            const connection = connections.find(conn => conn.id === connectionId);
            
            if (!connection) {
                log.warn(`Connection with ID ${connectionId} not found in credential manager`);
                log.traceExit('getConnectionById', null);
                return null;
            }
            
            log.info(`Found connection: ${connection.name} (${connection.type})`);
            
            // For connections with stored passwords, we need to retrieve them from the secrets storage
            let fullConnection = { ...connection };
            
            // Try to get password from VS Code secrets storage
            if (connection.authType === 'basic' || connection.authType === 'password') {
                try {
                    if (CredentialManagerService.extensionContext) {
                        const secretKey = `credentialManager.secret.${connectionId}`;
                        log.debug(`Looking for password secret with key: ${secretKey}`);

                        const secret = await CredentialManagerService.extensionContext.secrets.get(secretKey);
                        if (secret) {
                            log.info(`Found password secret for connection ${connectionId}`);
                            // Based on credential manager code, secret is stored as plain string
                            fullConnection.password = secret;
                            log.info('Retrieved password from secrets storage');
                        } else {
                            log.warn(`Password not found in secrets storage with key: ${secretKey}`);
                            
                            // Check if there's a legacy password in the connection object itself
                            if ((connection as any).password) {
                                log.info('Found legacy password in connection object');
                                try {
                                    // Try to decode base64 legacy password
                                    const legacyPassword = Buffer.from((connection as any).password, 'base64').toString();
                                    fullConnection.password = legacyPassword;
                                    log.info('Retrieved legacy password (base64 decoded)');
                                } catch (error) {
                                    // If base64 decoding fails, use as-is
                                    fullConnection.password = (connection as any).password;
                                    log.info('Retrieved legacy password (plain text)');
                                }
                            } else {
                                // Last resort: try to get the credential directly from the credential manager extension API
                                try {
                                    const credManagerExtension = vscode.extensions.getExtension('IuliusHutuleac.credential-manager');
                                    if (credManagerExtension && credManagerExtension.isActive) {
                                        log.info('Trying to access credential manager extension API directly');
                                        // @ts-ignore - Accessing the extension's exports which TypeScript doesn't know about
                                        const api = credManagerExtension.exports;
                                        if (api && typeof api.getCredential === 'function') {
                                            try {
                                                const credential = await api.getCredential(connectionId);
                                                if (credential) {
                                                    log.info('Successfully retrieved credential via direct API access');
                                                    fullConnection.password = credential;
                                                } else {
                                                    log.warn('No credential found via direct API access');
                                                }
                                            } catch (apiError) {
                                                log.error('Error accessing credential via API:', apiError);
                                            }
                                        } else {
                                            log.warn('Credential manager API not available or incompatible');
                                        }
                                    } else {
                                        log.warn('Credential manager extension not found or not active');
                                    }
                                } catch (extError) {
                                    log.error('Error accessing credential manager extension:', extError);
                                }
                            }
                        }
                    } else {
                        log.warn('Extension context not available for secrets access');
                    }
                } catch (error: any) {
                    log.error(`Failed to retrieve password from secrets: ${error.message}`);
                }
            } else if (connection.authType === 'bearer' || connection.authType === 'token') {
                // Try to get bearer token from VS Code secrets storage
                try {
                    if (CredentialManagerService.extensionContext) {
                        const secretKey = `credentialManager.secret.${connectionId}`;
                        log.debug(`Looking for bearer token secret with key: ${secretKey}`);
                        
                        const secret = await CredentialManagerService.extensionContext.secrets.get(secretKey);
                        if (secret) {
                            log.info(`Found bearer token secret for connection ${connectionId}`);
                            // Based on credential manager code, secret is stored as plain string
                            fullConnection.apiToken = secret;
                            log.info('Retrieved bearer token from secrets storage');
                        } else {
                            log.warn(`Bearer token not found in secrets storage with key: ${secretKey}`);
                        }
                    } else {
                        log.warn('Extension context not available for secrets access');
                    }
                } catch (error: any) {
                    log.error(`Failed to retrieve bearer token from secrets: ${error.message}`);
                    
                    // Try direct access to credential manager extension as fallback for bearer token
                    try {
                        const credManagerExtension = vscode.extensions.getExtension('IuliusHutuleac.credential-manager');
                        if (credManagerExtension && credManagerExtension.isActive) {
                            log.info('Trying to access credential manager extension API directly for bearer token');
                            // @ts-ignore - Accessing the extension's exports
                            const api = credManagerExtension.exports;
                            if (api && typeof api.getCredential === 'function') {
                                try {
                                    const credential = await api.getCredential(connectionId);
                                    if (credential) {
                                        log.info('Successfully retrieved bearer token via direct API access');
                                        fullConnection.apiToken = credential;
                                    }
                                } catch (apiError) {
                                    log.error('Error accessing bearer token via API:', apiError);
                                }
                            }
                        }
                    } catch (extError) {
                        log.error('Error accessing credential manager extension for bearer token:', extError);
                    }
                }
            }
            
            log.traceExit('getConnectionById', fullConnection);
            return fullConnection;
            
        } catch (error: any) {
            log.error(`Failed to get connection: ${error.message}`);
            log.traceExit('getConnectionById', null);
            return null;
        }
    }
    
    /**
     * Convert credential manager connection to FlinkApi credentials
     */
    public static connectionToCredentials(connection: CredentialConnection): GatewayCredentials {
        log.traceEnter('connectionToCredentials', { connectionId: connection.id });
        
        const credentials: GatewayCredentials = {};
        
        if (connection.authType === 'basic') {
            credentials.username = connection.username;
            credentials.password = connection.password;
        } else if (connection.authType === 'bearer' || connection.authType === 'token') {
            credentials.apiToken = connection.apiToken;
        }
        
        log.info(`Converted credentials for auth type: ${connection.authType}`);
        log.traceExit('connectionToCredentials', { hasUsername: !!credentials.username, hasPassword: !!credentials.password, hasToken: !!credentials.apiToken });
        
        return credentials;
    }
    
    /**
     * Get credentials for a connection ID
     */
    public static async getCredentialsById(connectionId: string): Promise<GatewayCredentials | null> {
        log.traceEnter('getCredentialsById', { connectionId });
        
        const connection = await CredentialManagerService.getConnectionById(connectionId);
        if (!connection) {
            log.traceExit('getCredentialsById', null);
            return null;
        }
        
        const credentials = CredentialManagerService.connectionToCredentials(connection);
        log.traceExit('getCredentialsById', credentials);
        return credentials;
    }
    
    /**
     * Get connection URL by connection ID
     */
    public static async getConnectionUrl(connectionId: string): Promise<string | null> {
        log.traceEnter('getConnectionUrl', { connectionId });
        
        const connection = await CredentialManagerService.getConnectionById(connectionId);
        const url = connection?.url || null;
        
        log.traceExit('getConnectionUrl', { url });
        return url;
    }
    
    /**
     * Get all connections from credential manager
     */
    public static getAllConnections(): CredentialConnection[] {
        log.traceEnter('getAllConnections');
        
        try {
            const config = vscode.workspace.getConfiguration();
            const connections = config.get<CredentialConnection[]>('credentialManager.connections', []);
            
            log.info(`Found ${connections.length} total connections in credential manager`);
            log.traceExit('getAllConnections', { count: connections.length });
            
            return connections;
        } catch (error: any) {
            log.error('Failed to get all connections:', error);
            log.traceExit('getAllConnections', { count: 0 });
            return [];
        }
    }
}
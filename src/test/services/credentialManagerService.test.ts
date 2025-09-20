import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { CredentialManagerService } from '../../services/CredentialManagerService';

suite('CredentialManagerService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: Partial<vscode.ExtensionContext>;
    let mockSecrets: Partial<vscode.SecretStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockSecrets = {
            get: sandbox.stub(),
            store: sandbox.stub(),
            delete: sandbox.stub()
        };

        mockContext = {
            secrets: mockSecrets as vscode.SecretStorage
        };

        // Initialize the service with mock context
        CredentialManagerService.initialize(mockContext as vscode.ExtensionContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Connection Management', () => {
        test('should retrieve connection by ID', async () => {
            // Mock workspace configuration
            const mockConfig = {
                get: sandbox.stub().returns([
                    {
                        id: 'test-connection',
                        name: 'Test Connection',
                        type: 'flink-gateway',
                        url: 'http://localhost:8083',
                        authType: 'basic',
                        username: 'testuser'
                    }
                ])
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
            
            // Mock secret retrieval
            (mockSecrets.get as sinon.SinonStub).resolves('testpassword');

            const connection = await CredentialManagerService.getConnectionById('test-connection');

            assert.ok(connection);
            assert.strictEqual(connection!.id, 'test-connection');
            assert.strictEqual(connection!.name, 'Test Connection');
            assert.strictEqual(connection!.url, 'http://localhost:8083');
            assert.strictEqual(connection!.password, 'testpassword');
        });

        test('should return null for non-existent connection', async () => {
            const mockConfig = {
                get: sandbox.stub().returns([])
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            const connection = await CredentialManagerService.getConnectionById('non-existent');

            assert.strictEqual(connection, null);
        });

        test('should convert connection to credentials correctly', () => {
            const connection = {
                id: 'test',
                name: 'Test',
                type: 'flink-gateway',
                url: 'http://localhost:8083',
                authType: 'basic',
                username: 'user',
                password: 'pass'
            };

            const credentials = CredentialManagerService.connectionToCredentials(connection);

            assert.strictEqual(credentials.username, 'user');
            assert.strictEqual(credentials.password, 'pass');
            assert.strictEqual(credentials.apiToken, undefined);
        });

        test('should handle bearer token auth type', () => {
            const connection = {
                id: 'test',
                name: 'Test',
                type: 'flink-gateway',
                url: 'http://localhost:8083',
                authType: 'bearer',
                apiToken: 'test-token'
            };

            const credentials = CredentialManagerService.connectionToCredentials(connection);

            assert.strictEqual(credentials.username, undefined);
            assert.strictEqual(credentials.password, undefined);
            assert.strictEqual(credentials.apiToken, 'test-token');
        });
    });

    suite('Error Handling', () => {
        test('should handle missing credentials gracefully', async () => {
            const mockConfig = {
                get: sandbox.stub().returns([
                    {
                        id: 'test-connection',
                        name: 'Test Connection',
                        type: 'flink-gateway',
                        url: 'http://localhost:8083',
                        authType: 'basic',
                        username: 'testuser'
                    }
                ])
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
            
            // Mock secret retrieval failure
            (mockSecrets.get as sinon.SinonStub).resolves(undefined);

            const connection = await CredentialManagerService.getConnectionById('test-connection');

            assert.ok(connection);
            assert.strictEqual(connection!.password, undefined);
        });

        test('should handle configuration errors', async () => {
            const mockConfig = {
                get: sandbox.stub().throws(new Error('Configuration error'))
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            const connection = await CredentialManagerService.getConnectionById('test-connection');

            assert.strictEqual(connection, null);
        });
    });
});
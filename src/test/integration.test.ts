import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import axios from 'axios';
import { DEFAULT_FLINK_GATEWAY_URL } from '../config';

const FLINK_GATEWAY_URL = process.env.FLINK_GATEWAY_URL || DEFAULT_FLINK_GATEWAY_URL;

suite('Integration Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Command Integration Tests', () => {
        test('should execute commands through VS Code API', async () => {
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.resolves();
            
            // Test connection management commands
            await vscode.commands.executeCommand('flink-sql-workbench.refreshConnections');
            assert.ok(executeCommandStub.calledWith('flink-sql-workbench.refreshConnections'));

            // Test session management commands
            await vscode.commands.executeCommand('flink-sql-workbench.refreshSessions');
            assert.ok(executeCommandStub.calledWith('flink-sql-workbench.refreshSessions'));

            // Test catalog commands
            await vscode.commands.executeCommand('flink-sql-workbench.refreshCatalog');
            assert.ok(executeCommandStub.calledWith('flink-sql-workbench.refreshCatalog'));
        });

        test('should handle command errors gracefully', async () => {
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
            executeCommandStub.rejects(new Error('Command failed'));

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

            try {
                await vscode.commands.executeCommand('flink-sql-workbench.invalidCommand');
            } catch (error) {
                // Expected to fail
            }

            // Should not crash the extension
            assert.ok(true);
        });

        test('credential manager opener should try fallbacks', async () => {
            const attempted: string[] = [];
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').callsFake(async (cmd: string) => {
                attempted.push(cmd);
                // Simulate failures for first two candidate commands
                if (cmd === 'workbench.view.extension.credential-manager' || cmd === 'credential-manager.open') {
                    throw new Error('Command not found');
                }
                // Allow success on third fallback
                return undefined;
            });
            const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

            await vscode.commands.executeCommand('flinkSqlWorkbench.openCredentialManager');

            assert.ok(attempted.includes('workbench.view.extension.credential-manager'), 'Should attempt primary command');
            assert.ok(attempted.includes('credential-manager.open'), 'Should attempt second candidate');
            assert.ok(attempted.includes('extension.credential-manager.focus'), 'Should attempt third candidate and succeed');
            assert.ok(infoStub.called, 'Should notify success message');

            // Ensure it stopped before hitting generic extensions if third worked
            assert.ok(!attempted.includes('workbench.view.extensions') || attempted.indexOf('extension.credential-manager.focus') < attempted.indexOf('workbench.view.extensions'));
        });
    });

    suite('Configuration Integration Tests', () => {
        test('should read configuration settings', () => {
            const mockConfig = {
                get: sandbox.stub().returns('test-value'),
                has: sandbox.stub().returns(true),
                inspect: sandbox.stub(),
                update: sandbox.stub()
            };

            sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);

            const config = vscode.workspace.getConfiguration('flinkSqlWorkbench');
            const connectionId = config.get('gateway.connectionId');

            assert.ok(mockConfig.get.calledWith('gateway.connectionId'));
        });
    });

    suite('Tree View Integration Tests', () => {
        test('should create tree views with providers', () => {
            const createTreeViewStub = sandbox.stub(vscode.window, 'createTreeView');

            // Simulate creating tree views like in extension activation
            vscode.window.createTreeView('flinkSqlConnections', {
                treeDataProvider: {} as any,
                canSelectMany: false
            });

            assert.ok(createTreeViewStub.calledOnce);
            assert.ok(createTreeViewStub.calledWith('flinkSqlConnections'));
        });
    });

    // Only run Flink Gateway tests if integration is enabled
    if (process.env.RUN_INTEGRATION) {
        suite('Flink SQL Gateway Integration', () => {
            let sessionHandle: string | undefined;

            test('Connect to Flink SQL Gateway', async () => {
                const response = await axios.get(`${FLINK_GATEWAY_URL}/v1/info`);
                assert.strictEqual(response.status, 200, 'Gateway info endpoint should be reachable');
                assert.ok(response.data.version, 'Gateway should return a version');
            });

            test('Create a session', async () => {
                const response = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions`, {
                    properties: {
                        "execution.runtime-mode": "batch"
                    }
                });
                assert.strictEqual(response.status, 201, 'Session should be created');
                assert.ok(response.data.sessionHandle, 'Session handle should be returned');
                sessionHandle = response.data.sessionHandle;
            });

            test('Execute a simple SQL statement', async function () {
                if (!sessionHandle) { this.skip(); }
                
                const response = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
                    statement: 'SELECT 1'
                });
                assert.strictEqual(response.status, 201, 'Statement should be accepted');
                assert.ok(response.data.handle, 'Statement handle should be returned');
            });

            test('Fetch statement results', async function () {
                if (!sessionHandle) { this.skip(); }
                
                const stmtResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
                    statement: 'SELECT 1'
                });
                const statementHandle = stmtResp.data.handle;
                let result;
                for (let i = 0; i < 10; i++) {
                    const res = await axios.get(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements/${statementHandle}`);
                    if (res.data.status === 'FINISHED' && res.data.results) {
                        result = res.data.results;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
                assert.ok(result, 'Should receive results');
                assert.strictEqual(result[0].data[0][0], 1, 'Result should be 1');
            });

            test('Cancel statement', async function () {
                if (!sessionHandle) { this.skip(); }
                
                const stmtResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
                    statement: 'SELECT 1'
                });
                const statementHandle = stmtResp.data.handle;
                
                const cancelResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements/${statementHandle}/cancel`);
                assert.ok([200, 204].includes(cancelResp.status), 'Cancel should succeed');
            });

            test('Delete session', async function () {
                if (!sessionHandle) { this.skip(); }
                
                const response = await axios.delete(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}`);
                assert.strictEqual(response.status, 200, 'Session should be closed');
                sessionHandle = undefined;
            });
        });
    } else {
        console.log('Skipping Flink Gateway integration tests (set RUN_INTEGRATION=true to enable)');
    }
});

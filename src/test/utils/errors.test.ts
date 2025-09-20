import * as assert from 'assert';
import * as sinon from 'sinon';
import { GlobalErrorHandler, UserNotificationService, ValidationHelper } from '../../utils/errors';

suite('Error Utilities Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        GlobalErrorHandler.initialize();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('GlobalErrorHandler', () => {
        test('should handle errors with user notification', async () => {
            const mockShowErrorMessage = sandbox.stub().resolves('Show Logs');
            sandbox.stub(require('vscode'), 'window').value({
                showErrorMessage: mockShowErrorMessage,
                createOutputChannel: sandbox.stub().returns({
                    appendLine: sandbox.stub(),
                    show: sandbox.stub()
                })
            });

            await GlobalErrorHandler.handleError(
                new Error('Test error'),
                'Test Context',
                true,
                'Custom error message'
            );

            assert.ok(mockShowErrorMessage.calledOnce);
            assert.ok(mockShowErrorMessage.calledWith('Custom error message'));
        });

        test('should wrap operations with error handling', async () => {
            const operation = sandbox.stub().rejects(new Error('Operation failed'));
            
            const result = await GlobalErrorHandler.withErrorHandling(
                operation,
                'Test Operation',
                false
            );

            assert.strictEqual(result, null);
            assert.ok(operation.calledOnce);
        });

        test('should return result on successful operation', async () => {
            const operation = sandbox.stub().resolves('success');
            
            const result = await GlobalErrorHandler.withErrorHandling(
                operation,
                'Test Operation',
                false
            );

            assert.strictEqual(result, 'success');
        });
    });

    suite('ValidationHelper', () => {
        test('should validate connection config correctly', () => {
            const validConfig = {
                url: 'http://localhost:8083',
                timeout: 30000
            };

            const result = ValidationHelper.validateConnectionConfig(validConfig);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect invalid connection config', () => {
            const invalidConfig = {
                url: '',
                timeout: -1
            };

            const result = ValidationHelper.validateConnectionConfig(invalidConfig);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors.some(error => error.includes('URL')));
            assert.ok(result.errors.some(error => error.includes('Timeout')));
        });

        test('should validate session properties correctly', () => {
            const validProperties = {
                'execution.runtime-mode': 'streaming',
                'table.exec.resource.default-parallelism': '4'
            };

            const result = ValidationHelper.validateSessionProperties(validProperties);

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect invalid session properties', () => {
            const invalidProperties = {
                'execution.runtime-mode': 'invalid',
                'table.exec.resource.default-parallelism': 'not-a-number'
            };

            const result = ValidationHelper.validateSessionProperties(invalidProperties);

            assert.strictEqual(result.isValid, false);
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors.some(error => error.includes('runtime-mode')));
            assert.ok(result.errors.some(error => error.includes('parallelism')));
        });
    });

    suite('UserNotificationService', () => {
        test('should show information message', async () => {
            const mockShowInfo = sandbox.stub().resolves('OK');
            sandbox.stub(require('vscode'), 'window').value({
                showInformationMessage: mockShowInfo
            });

            const result = await UserNotificationService.showInfo('Test message', 'OK');

            assert.ok(mockShowInfo.calledOnce);
            assert.ok(mockShowInfo.calledWith('Test message', 'OK'));
            assert.strictEqual(result, 'OK');
        });

        test('should confirm actions with modal', async () => {
            const mockShowWarning = sandbox.stub().resolves('Confirm');
            sandbox.stub(require('vscode'), 'window').value({
                showWarningMessage: mockShowWarning
            });

            const result = await UserNotificationService.confirmAction(
                'Are you sure?',
                'Confirm'
            );

            assert.ok(mockShowWarning.calledOnce);
            assert.strictEqual(result, true);
        });

        test('should handle cancelled confirmations', async () => {
            const mockShowWarning = sandbox.stub().resolves(undefined);
            sandbox.stub(require('vscode'), 'window').value({
                showWarningMessage: mockShowWarning
            });

            const result = await UserNotificationService.confirmAction(
                'Are you sure?',
                'Confirm'
            );

            assert.strictEqual(result, false);
        });
    });
});
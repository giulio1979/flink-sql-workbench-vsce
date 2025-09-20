import * as assert from 'assert';
import * as sinon from 'sinon';
import { FlinkApiService } from '../../services/FlinkApiService';

suite('FlinkApiService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let apiService: FlinkApiService;
    let mockFetch: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock global fetch
        mockFetch = sandbox.stub(global, 'fetch' as any);
        
        apiService = new FlinkApiService('http://localhost:8083');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Request Handling', () => {
        test('should make successful API request', async () => {
            const mockResponse = {
                ok: true,
                json: sandbox.stub().resolves({ version: '1.0.0' })
            };

            mockFetch.resolves(mockResponse);

            const result = await apiService.request('/v1/config');

            assert.ok(mockFetch.calledOnce);
            assert.ok(mockFetch.calledWith('http://localhost:8083/v1/config'));
            assert.deepStrictEqual(result, { version: '1.0.0' });
        });

        test('should handle HTTP errors', async () => {
            const mockResponse = {
                ok: false,
                status: 404,
                text: sandbox.stub().resolves('Not Found')
            };

            mockFetch.resolves(mockResponse);

            try {
                await apiService.request('/v1/invalid');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.includes('404'));
            }
        });

        test('should handle network errors', async () => {
            mockFetch.rejects(new Error('Network error'));

            try {
                await apiService.request('/v1/config');
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual((error as Error).message, 'Network error');
            }
        });
    });

    suite('Authentication', () => {
        test('should add basic auth headers', async () => {
            apiService.setCredentials('user', 'pass');

            const mockResponse = {
                ok: true,
                json: sandbox.stub().resolves({})
            };

            mockFetch.resolves(mockResponse);

            await apiService.request('/v1/config');

            const callArgs = mockFetch.getCall(0).args;
            const headers = callArgs[1].headers;
            
            assert.ok(headers.Authorization);
            assert.ok(headers.Authorization.startsWith('Basic '));
        });

        test('should add bearer token headers', async () => {
            apiService.setCredentials(undefined, undefined, 'test-token');

            const mockResponse = {
                ok: true,
                json: sandbox.stub().resolves({})
            };

            mockFetch.resolves(mockResponse);

            await apiService.request('/v1/config');

            const callArgs = mockFetch.getCall(0).args;
            const headers = callArgs[1].headers;
            
            assert.strictEqual(headers.Authorization, 'Bearer test-token');
        });
    });

    suite('Proxy Handling', () => {
        test('should use proxy URL when configured', () => {
            const proxyService = new FlinkApiService('/api/flink');
            
            // Access private method for testing
            const proxyUrl = (proxyService as any).getProxyUrl('/v1/config');
            
            assert.strictEqual(proxyUrl, '/api/flink/v1/config');
        });

        test('should use direct URL when not using proxy', () => {
            const directService = new FlinkApiService('http://localhost:8083');
            
            // Access private method for testing
            const directUrl = (directService as any).getProxyUrl('/v1/config');
            
            assert.strictEqual(directUrl, 'http://localhost:8083/v1/config');
        });
    });
});
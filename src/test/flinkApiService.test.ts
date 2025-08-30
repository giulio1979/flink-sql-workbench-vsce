import * as assert from 'assert';
import nock from 'nock';
import { FlinkApiService } from '../services/FlinkApiService';

suite('FlinkApiService unit tests', () => {
    const baseUrl = 'http://localhost:8083';
    const flink = new FlinkApiService(baseUrl);

    teardown(() => {
        nock.cleanAll();
    });

    test('getInfo should try v1 then v2 and return v1 result', async () => {
        nock(baseUrl)
            .get('/v1/info')
            .reply(200, { version: '1.0' });

        const info = await flink.getInfo();
        assert.strictEqual(info.version, '1.0');
    });

    test('createSession should post to sessions and return session handle', async () => {
        nock(baseUrl)
            .post('/v1/sessions', body => {
                return body && body.properties;
            })
            .reply(201, { sessionHandle: 'abc-123' });

        const resp = await flink.createSession({ 'execution.runtime-mode': 'batch' });
        assert.strictEqual(resp.sessionHandle, 'abc-123');
    });

    test('submitStatement should return operationHandle', async () => {
        const sessionHandle = 'abc-123';
        nock(baseUrl)
            .post(`/v1/sessions/${sessionHandle}/statements`)
            .reply(201, { operationHandle: 'op-1' });

        const resp = await flink.submitStatement(sessionHandle, 'SELECT 1');
        assert.strictEqual(resp.operationHandle, 'op-1');
    });
});

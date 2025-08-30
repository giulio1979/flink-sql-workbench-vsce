import * as assert from 'assert';
import nock from 'nock';
import { FlinkApiService } from '../services/FlinkApiService';
import { DEFAULT_FLINK_GATEWAY_URL } from '../config';

suite('FlinkApiService getAllResults tests', () => {
    const baseUrl = DEFAULT_FLINK_GATEWAY_URL;
    const flink = new FlinkApiService(baseUrl);

    teardown(() => {
        nock.cleanAll();
    });

    test('getAllResults paginates through result tokens and aggregates rows and columns', async () => {
        const sessionHandle = 'sess-x';
        const operationHandle = 'op-x';

        // First page returns one row and a nextResultUri
        nock(baseUrl)
            .get(`/v1/sessions/${sessionHandle}/operations/${operationHandle}/result/0`)
            .query({ rowFormat: 'JSON' })
            .reply(200, {
                resultType: 'PAYLOAD',
                resultKind: 'SUCCESS_WITH_CONTENT',
                results: {
                    columns: [{ name: 'one' }],
                    data: [ [1] ]
                },
                nextResultUri: `/v1/sessions/${sessionHandle}/operations/${operationHandle}/result/1`
            });

        // Second page returns EOS and another row
        nock(baseUrl)
            .get(`/v1/sessions/${sessionHandle}/operations/${operationHandle}/result/1`)
            .query({ rowFormat: 'JSON' })
            .reply(200, {
                resultType: 'EOS',
                resultKind: 'SUCCESS_WITH_CONTENT',
                results: {
                    data: [ [2] ]
                }
            });

        const { results, columns } = await flink.getAllResults(sessionHandle, operationHandle);

        // Expect two rows aggregated and one column
        assert.strictEqual(results.length, 2);
        assert.strictEqual(columns.length, 1);
        assert.strictEqual(results[0][0], 1);
        assert.strictEqual(results[1][0], 2);
    });

    test('getAllResults should surface parsed root cause from error response', async () => {
        const sessionHandle = 'sess-err';
        const operationHandle = 'op-err';

        // Respond with HTTP 500 and JSON body containing Java stack with Caused by
        const errorBody = JSON.stringify({
            errors: [
                "org.apache.FlinkException: Top level\nCaused by: java.lang.RuntimeException: RootCauseMessage"
            ]
        });

        nock(baseUrl)
            .get(`/v1/sessions/${sessionHandle}/operations/${operationHandle}/result/0`)
            .query({ rowFormat: 'JSON' })
            .reply(500, errorBody);

        let threw = false;
        try {
            await flink.getAllResults(sessionHandle, operationHandle);
        } catch (err: any) {
            threw = true;
            // Ensure the error message includes the parsed root cause
            assert.ok(err.message.includes('RootCauseMessage') || err.message.includes('RootCause'), `unexpected error message: ${err.message}`);
        }

        assert.ok(threw, 'Expected getAllResults to throw on HTTP 500');
    });
});

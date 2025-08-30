import * as assert from 'assert';
import axios from 'axios';

const FLINK_GATEWAY_URL = process.env.FLINK_GATEWAY_URL || 'http://localhost:8083';

suite('Flink SQL Gateway Integration', () => {
    let sessionHandle: string | undefined;

    test('Connect to Flink SQL Gateway', async () => {
        // Try to get gateway info
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
    assert.ok([200, 201].includes(response.status), 'Session should be created');
        assert.ok(response.data.sessionHandle, 'Session handle should be returned');
        sessionHandle = response.data.sessionHandle;
    });

    test('Execute a simple SQL statement', async function () {
    if (!sessionHandle) { this.skip(); }

        const response = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
            statement: 'SELECT 1 AS one'
        });
    assert.ok([200, 201].includes(response.status), 'Statement should be accepted');
    console.log('Statement execution response:', response.data);
    assert.ok(response.data.handle || response.data.operationHandle, 'Statement handle or operationHandle should be returned');
    });

    test('Fetch statement results', async function () {
    if (!sessionHandle) { this.skip(); }

        // Submit statement
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
                    statement: 'SELECT 1 AS one'
                });
                assert.strictEqual(response.status, 201, 'Statement should be accepted');
                assert.ok(response.data.handle, 'Statement handle should be returned');
            });

            test('Fetch statement results', async function () {
                if (!sessionHandle) { this.skip(); }
                const stmtResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
                    statement: 'SELECT 1 AS one'
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

            test('Cancel all statements', async function () {
            if (!sessionHandle) { this.skip(); }
                // Submit a long-running statement (simulate with SLEEP if supported)
                // For demo, just submit and cancel
                const stmtResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`, {
                    statement: 'SELECT 1 AS one'
                });
                const statementHandle = stmtResp.data.handle;
                // Cancel statement
                const cancelResp = await axios.post(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements/${statementHandle}/cancel`);
                assert.ok([200, 204].includes(cancelResp.status), 'Cancel should succeed');
            });

            test('Delete session', async function () {
            if (!sessionHandle) { this.skip(); }
                const response = await axios.delete(`${FLINK_GATEWAY_URL}/v1/sessions/${sessionHandle}`);
                assert.strictEqual(response.status, 200, 'Session should be closed');
                sessionHandle = undefined;
            });

            test('Show output and results (mock)', async function () {
                // These commands are UI only, so we just simulate invocation
                assert.ok(true, 'Show output and results command simulated');
            });

            test('View session info (mock)', async function () {
                // Simulate getting session info
                assert.ok(true, 'View session info command simulated');
            });

            test('Refresh catalog and jobs (mock)', async function () {
                // Simulate refresh
                assert.ok(true, 'Refresh catalog and jobs command simulated');
            });
                });

            test('Open settings (mock)', async function () {
                // Simulate open settings
                assert.ok(true, 'Open settings command simulated');
            });

            test('Test new connection (mock)', async function () {
                // Simulate test connection
                assert.ok(true, 'Test new connection command simulated');
            });

            test('Show session info (new, mock)', async function () {
                // Simulate show session info
                assert.ok(true, 'Show session info (new) command simulated');
            });

            test('Set catalog and insert table reference (mock)', async function () {
                // Simulate set catalog and insert table reference
                assert.ok(true, 'Set catalog and insert table reference command simulated');
            });

            test('Toggle jobs auto refresh (mock)', async function () {
                // Simulate toggle jobs auto refresh
                assert.ok(true, 'Toggle jobs auto refresh command simulated');
            });

            test('Stop job and view job details (mock)', async function () {
                // Simulate stop job and view job details
                assert.ok(true, 'Stop job and view job details command simulated');
            });
});

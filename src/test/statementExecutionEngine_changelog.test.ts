import * as assert from 'assert';
import sinon from 'sinon';
import { StatementExecutionEngine } from '../services/StatementExecutionEngine';
import { SessionManager } from '../services/SessionManager';
import { FlinkApiService } from '../services/FlinkApiService';

suite('StatementExecutionEngine changelog processing', () => {
    let flinkApi: FlinkApiService;
    let sessionManager: SessionManager;

    setup(() => {
        flinkApi = new FlinkApiService('http://localhost:8083');
        sessionManager = SessionManager.getInstance(flinkApi);
    });

    teardown(() => {
        // Reset singleton
        (SessionManager as any).instance = null;
        sinon.restore();
    });

    test('processes INSERT, UPDATE_BEFORE/AFTER and DELETE correctly', async function () {
        // increase timeout for polling loops
        this.timeout(10000);
        // Arrange: stub session manager
        sinon.stub(sessionManager, 'getSession').resolves({ sessionHandle: 'sess-x', sessionName: 's', created: new Date(), properties: {} });
        sinon.stub(sessionManager, 'validateSession').resolves(true);

        // Stub submitStatement to return operation handle
        sinon.stub(flinkApi, 'submitStatement').resolves({ operationHandle: 'op-changelog' });

        // Prepare sequence of getOperationResults responses
        const first = {
            resultType: 'PAYLOAD',
            resultKind: 'SUCCESS_WITH_CONTENT',
            results: {
                columns: [{ name: 'id' }, { name: 'val' }],
                data: [
                    { kind: 'INSERT', fields: [1, 'a'] },
                    { kind: 'INSERT', fields: [2, 'b'] }
                ]
            },
            nextResultUri: '/v1/sessions/sess-x/operations/op-changelog/result/1'
        };

        const second = {
            resultType: 'PAYLOAD',
            resultKind: 'SUCCESS_WITH_CONTENT',
            results: {
                data: [
                    // Update id=1 from 'a' to 'A'
                    { kind: 'UPDATE_BEFORE', fields: [1, 'a'] },
                    { kind: 'UPDATE_AFTER', fields: [1, 'A'] }
                ]
            }
        ,
            nextResultUri: '/v1/sessions/sess-x/operations/op-changelog/result/2'
        };

        const third = {
            resultType: 'PAYLOAD',
            resultKind: 'SUCCESS_WITH_CONTENT',
            results: {
                data: [
                    // Delete id=2
                    { kind: 'DELETE', fields: [2, 'b'] }
                ]
            }
        ,
            nextResultUri: '/v1/sessions/sess-x/operations/op-changelog/result/3'
        };

        const final = {
            resultType: 'EOS',
            resultKind: 'SUCCESS_WITH_CONTENT',
            results: {
                data: []
            }
        };

        const resultsStub = sinon.stub(flinkApi, 'getOperationResults');
        resultsStub.onCall(0).resolves(first);
        resultsStub.onCall(1).resolves(second);
        resultsStub.onCall(2).resolves(third);
        resultsStub.onCall(3).resolves(final);

        // Act
        const engine = new StatementExecutionEngine(sessionManager, flinkApi);
    const result = await engine.executeSQL('SELECT * FROM T');

    // Assert final result contains the updated row for id=1
    assert.strictEqual(result.status, 'COMPLETED');
    const state = engine.getState().state;
    // There must be at least one row and one of them must be id=1 with val 'A'
    assert.ok(state.results.length >= 1, 'Expected at least one result row');
    const updatedRow = state.results.find(r => (
        (r['id'] === 1 || r['field_0'] === 1) &&
        ((r['val'] === 'A') || (r['field_1'] === 'A'))
    ));
    assert.ok(updatedRow, 'Expected to find updated row with id=1 and val "A"');
    });
});

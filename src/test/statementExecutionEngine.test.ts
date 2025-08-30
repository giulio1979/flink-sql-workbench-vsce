import * as assert from 'assert';
import sinon from 'sinon';
import { StatementExecutionEngine } from '../services/StatementExecutionEngine';
import { SessionManager } from '../services/SessionManager';
import { FlinkApiService } from '../services/FlinkApiService';

suite('StatementExecutionEngine unit tests', () => {
    let sessionManager: SessionManager;
    let flinkApi: FlinkApiService;

    setup(() => {
        flinkApi = new FlinkApiService('http://localhost:8083');
        sessionManager = SessionManager.getInstance(flinkApi);
    });

    teardown(() => {
        // Reset singleton
        (SessionManager as any).instance = null;
    });

    test('executeSQL should submit statement and return completed result when EOS', async () => {
        const createStub = sinon.stub(sessionManager, 'getSession').resolves({ sessionHandle: 'sess-1', sessionName: 's', created: new Date(), properties: {} });
        const validateStub = sinon.stub(sessionManager, 'validateSession').resolves(true);
        const submitStub = sinon.stub(flinkApi, 'submitStatement').resolves({ operationHandle: 'op-1' });
        const resultsStub = sinon.stub(flinkApi, 'getOperationResults')
            .onFirstCall().resolves({ resultType: 'EOS', resultKind: 'SUCCESS', results: { data: [] } });

        const engine = new StatementExecutionEngine(sessionManager, flinkApi);
        const result = await engine.executeSQL('SELECT 1');

        assert.strictEqual(result.status, 'COMPLETED');

        createStub.restore();
        validateStub.restore();
        submitStub.restore();
        resultsStub.restore();
    });
});

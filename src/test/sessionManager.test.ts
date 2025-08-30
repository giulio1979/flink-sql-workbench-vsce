import * as assert from 'assert';
import sinon from 'sinon';
import { SessionManager } from '../services/SessionManager';
import { FlinkApiService } from '../services/FlinkApiService';
import { DEFAULT_FLINK_GATEWAY_URL } from '../config';

suite('SessionManager unit tests', () => {
    let flinkApi: FlinkApiService;
    let manager: SessionManager;

    setup(() => {
    flinkApi = new FlinkApiService(DEFAULT_FLINK_GATEWAY_URL);
        manager = SessionManager.getInstance(flinkApi);
    });

    teardown(async () => {
        // Ensure session is closed and singleton reset via dispose
        try { await manager.closeSession(); } catch (e) { /* ignore */ }
        manager.dispose();
        // Reset singleton for isolation
        (SessionManager as any).instance = null;
    });

    test('createSession should call flinkApi.createSession and populate session info', async () => {
        const stub = sinon.stub(flinkApi, 'createSession').resolves({ sessionHandle: 'sess-1' });

        const info = await manager.createSession({});
        assert.strictEqual(info.sessionHandle, 'sess-1');
        assert.ok(manager.isConnected());

        stub.restore();
    });

    test('closeSession should call flinkApi.closeSession if connected', async () => {
        // Use a UUID-like session handle so SessionManager's UUID guard
        // will attempt to call flinkApi.closeSession during close.
        const uuidHandle = 'ffe6bfd2-adac-44b1-bbe8-b5438bf3b289';
        const createStub = sinon.stub(flinkApi, 'createSession').resolves({ sessionHandle: uuidHandle });
        const closeStub = sinon.stub(flinkApi, 'closeSession').resolves({});

        await manager.createSession({});
        await manager.closeSession();

        assert.ok(closeStub.calledOnce);

        createStub.restore();
        closeStub.restore();
    });
});

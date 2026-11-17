import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { workerRequest } from "../src/core/worker_request";

const messages = { cancelled: "Cancelled", timeout: "Timed out", failed: "Worker failed" };

function fixture(t: TestContext, sendError?: Error) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    const worker = {
        onmessage: null as Worker["onmessage"], onerror: null as Worker["onerror"],
        terminate: t.mock.fn(),
        postMessage: t.mock.fn((_input: unknown) => { if (sendError) throw sendError; })
    };
    const create = t.mock.fn(() => worker as unknown as Worker);
    const start = () => workerRequest<{ value: number }>(create, { request: "render" }, controller.signal, messages);
    const reply = (data: unknown) => worker.onmessage?.call(worker as unknown as Worker, { data } as MessageEvent);
    const fail = (message: string) => worker.onerror?.call(worker as unknown as Worker, { message } as ErrorEvent);
    const released = () => {
        assert.equal(worker.terminate.mock.callCount(), 1, "the disposable worker is released");
        assert.equal(worker.onmessage, null);
        assert.equal(worker.onerror, null);
        controller.abort();
        t.mock.timers.tick(30000);
        assert.equal(worker.terminate.mock.callCount(), 1, "neither cancellation nor timeout runs after completion");
    };
    return { controller, worker, create, start, reply, fail, released };
}

test("a worker result resolves the request and releases resources before returning", async t => {
    const f = fixture(t);
    const result = f.start();
    assert.deepEqual(f.worker.postMessage.mock.calls[0].arguments, [{ request: "render" }]);
    f.reply({ value: 7 });
    assert.deepEqual(await result, { value: 7 });
    f.released();
});

test("worker-reported failures and uncaught errors release resources", async t => {
    for (const failure of ["reply", "event", "empty-event"] as const) {
        await t.test(failure, async subtest => {
            const f = fixture(subtest);
            const result = f.start();
            const rejected = assert.rejects(result, { message: failure === "empty-event" ? messages.failed : "Conversion failed" });
            if (failure === "reply") f.reply({ error: "Conversion failed" });
            else f.fail(failure === "event" ? "Conversion failed" : "");
            await rejected;
            f.released();
        });
    }
});

test("cancelling a worker rejects with AbortError and clears its deadline", async t => {
    const f = fixture(t);
    const result = f.start();
    const rejected = assert.rejects(result, { name: "AbortError", message: messages.cancelled });
    f.controller.abort();
    await rejected;
    f.released();
});

test("a worker that never replies is stopped after 30 seconds", async t => {
    const f = fixture(t);
    const rejected = assert.rejects(f.start(), { message: messages.timeout });
    t.mock.timers.tick(29999);
    assert.equal(f.worker.terminate.mock.callCount(), 0);
    t.mock.timers.tick(1);
    await rejected;
    f.released();
});

test("a synchronous postMessage failure also releases the worker", async t => {
    const error = new DOMException("Cannot clone input", "DataCloneError");
    const f = fixture(t, error);
    await assert.rejects(f.start(), error);
    f.released();
});

test("an already cancelled request does not create a worker", t => {
    const f = fixture(t);
    f.controller.abort();
    assert.throws(f.start, { name: "AbortError" });
    assert.equal(f.create.mock.callCount(), 0);
});

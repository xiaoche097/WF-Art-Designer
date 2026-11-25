import assert from "node:assert/strict";
import { test } from "node:test";
import { runBananaImage } from "./bananaApi.js";
import { retryBananaOperation } from "./bananaRetry.js";

const config = { baseUrl: "https://provider.example", apiKey: "fixture-key", protocol: "openai" };
const task = { model: "gpt-image-2", prompt: "fixture", timeoutMs: 1000 };
const noDelay = async () => {};

test("retries only incomplete generation, including after many provider failures", async context => {
    let attempts = 0;
    const outcomes = [];
    context.mock.method(globalThis, "fetch", async () => {
        attempts++;
        if (attempts <= 8) return Response.json({ error: { message: "Model busy" } }, { status: 429 });
        if (attempts === 9) return Response.json({ data: [] });
        return Response.json({ data: [{ b64_json: "AQID" }] });
    });
    const result = await retryBananaOperation(() => runBananaImage(config, task, []), {
        wait: noDelay, onRetry: ({ delayMs }) => outcomes.push(delayMs),
    });
    assert.deepEqual(result, ["data:image/png;base64,AQID"]);
    assert.equal(attempts, 10);
    assert.deepEqual(outcomes.slice(0, 3), [3000, 6000, 12000]);
    assert.equal(outcomes.at(-1), 60000);
});

test("stops after Key errors, authorization errors and network failures", async context => {
    let calls = 0;
    let reply;
    context.mock.method(globalThis, "fetch", async () => { calls++; return reply(); });
    for (const response of [
        () => Response.json({ error: { message: "invalid API key fixture-key" } }, { status: 401 }),
        () => Response.json({ code: 403, message: "Forbidden" }),
        () => Response.json({ error: { code: "invalid_api_key", message: "Authentication failed" } }, { status: 400 }),
        () => Response.json({ error: { message: "Gateway Timeout" } }, { status: 504 }),
        () => { throw new TypeError("Failed to fetch"); },
    ]) {
        reply = response;
        const before = calls;
        await assert.rejects(retryBananaOperation(() => runBananaImage(config, task, []), { wait: noDelay }),
            error => error.retryable === false && !error.message.includes(config.apiKey));
        assert.equal(calls, before + 1);
    }
});

test("cancelling during backoff prevents any future submission", async () => {
    const controller = new AbortController();
    let calls = 0;
    const operation = retryBananaOperation(async () => {
        calls++;
        throw new Error("Model busy");
    }, { signal: controller.signal, onRetry: () => controller.abort() });
    await assert.rejects(operation, { name: "AbortError" });
    assert.equal(calls, 1);
});

test("an accepted task retries status checks on the same ID without a second generation", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const requests = [];
    let polls = 0;
    context.mock.method(globalThis, "fetch", async (url, options) => {
        requests.push([url, options.method]);
        if (options.method === "POST") {
            return Response.json({ status: "pending", task_id: "task-1", poll_url: "/v1/images/tasks/task-1" }, { status: 202 });
        }
        if (++polls === 1) return Response.json({ error: { message: "Busy" } }, { status: 503 });
        if (polls === 2) return Response.json({ status: "processing" });
        return Response.json({ status: "completed", result: { data: [{ url: "https://files.example/a.png" }] } });
    });
    const operation = retryBananaOperation(() => runBananaImage(config, task, []), { wait: noDelay });
    for (let step = 0; step < 4; step++) {
        await new Promise(resolve => setImmediate(resolve));
        context.mock.timers.tick(3000);
    }
    assert.deepEqual(await operation, ["https://files.example/a.png"]);
    assert.equal(requests.filter(([, method]) => method === "POST").length, 1);
    assert.deepEqual(requests.slice(1).map(([url]) => url), Array(3).fill("https://provider.example/v1/images/tasks/task-1"));
});

test("an accepted task without a safe query address does not create a duplicate", async context => {
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => {
        calls++;
        return Response.json({ status: "pending" }, { status: 202 });
    });
    await assert.rejects(runBananaImage(config, task, []), error => error.retryable === false && /任务 ID/.test(error.message));
    assert.equal(calls, 1);
});

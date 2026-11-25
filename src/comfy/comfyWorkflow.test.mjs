import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeComfyPrompt, buildComfyPromptForRun, parseComfyWorkflowJson } from "./comfyWorkflow.js";
import { queueComfyPrompt } from "./comfyApi.js";

const objectInfo = {
    LoadImage: { input: { required: { image: [["old.png"], { image_upload: true }] } } },
    "easy imageColorMatch": { input: { required: {
        image_ref: ["IMAGE"],
        image_target: ["IMAGE"],
        method: [["wavelet", "adain", "reinhard"]],
        image_output: ["COMBO", { options: ["Hide", "Preview", "Save", "Hide/Save"] }],
        save_prefix: ["STRING"],
    } } },
};

function apiPrompt() {
    return {
        1: { class_type: "LoadImage", inputs: { image: "old.png" } },
        2: { class_type: "LoadImage", inputs: { image: "old.png" } },
        1073: { class_type: "easy imageColorMatch", inputs: {
            image_ref: ["1", 0], image_target: ["2", 0], method: "wavelet", image_output: "Preview", save_prefix: "match",
        } },
        1094: { class_type: "easy imageColorMatch", inputs: {
            image_ref: ["1", 0], image_target: ["1073", 0], method: "adain", image_output: "Hide",
        } },
        1200: { class_type: "SaveImage", inputs: { images: ["1094", 0], filename_prefix: "output" } },
    };
}

const uploads = { "1::image": { name: "ref.png", subfolder: "wf-run" }, "2::image": { name: "target.png" } };

test("capture uses two real loaders and preserves both Color Match output dropdowns", () => {
    const base = apiPrompt();
    const rows = analyzeComfyPrompt(base, objectInfo);
    assert.deepEqual(rows.imageRows.map(row => row.key), ["1::image", "2::image"]);
    const result = buildComfyPromptForRun(base, rows.imageRows, rows.paramRows, {}, uploads, objectInfo);
    assert.equal(result[1].inputs.image, "wf-run/ref.png");
    assert.equal(result[2].inputs.image, "target.png");
    assert.deepEqual(result[1073].inputs, base[1073].inputs);
    assert.deepEqual(result[1094].inputs, base[1094].inputs);

    const stale = { key: "old-slot", nodeId: "1073", fieldName: "image_output" };
    assert.throws(() => buildComfyPromptForRun(base, [stale], [], {}, { "old-slot": uploads["1::image"] }, objectInfo),
        /工作流图像输入不存在/);
    const shared = buildComfyPromptForRun(base, [rows.imageRows[0]], [], {}, { "1::image": uploads["1::image"] }, objectInfo);
    assert.equal(shared[2].inputs.image, shared[1].inputs.image);
    assert.equal(shared[1073].inputs.image_output, "Preview");
});

test("regular canvas format maps image sockets separately from widgets", () => {
    const graph = {
        nodes: [
            { id: 1, type: "LoadImage", widgets_values: ["old.png"] },
            { id: 2, type: "LoadImage", widgets_values: ["old.png"] },
            { id: 1073, type: "easy imageColorMatch", inputs: [{ name: "image_ref", link: 10 }, { name: "image_target", link: 11 }],
                widgets_values: ["adain", " preview ", "saved-prefix"] },
        ],
        links: [[10, 1, 0, 1073, 0, "IMAGE"], [11, 2, 0, 1073, 1, "IMAGE"]],
    };
    const { prompt } = parseComfyWorkflowJson(graph, "test", objectInfo);
    assert.deepEqual(prompt[1073].inputs, {
        image_ref: ["1", 0], image_target: ["2", 0], method: "adain", image_output: "Preview", save_prefix: "saved-prefix",
    });
    assert.deepEqual(analyzeComfyPrompt(prompt).imageRows.map(row => row.key), ["1::image", "2::image"]);
});

test("unsupported Color Match modes are editable and reported with their actual value", () => {
    const base = apiPrompt();
    base[1094].inputs.image_output = "old-output-mode";
    const { imageRows, paramRows } = analyzeComfyPrompt(base, objectInfo);
    const key = "1094::image_output";
    assert.deepEqual(paramRows.find(row => row.key === key).options, ["Hide", "Preview", "Save", "Hide/Save"]);
    assert.throws(() => buildComfyPromptForRun(base, imageRows, paramRows, {}, uploads, objectInfo), /1094.*image_output.*old-output-mode/);
    assert.equal(buildComfyPromptForRun(base, imageRows, paramRows, { [key]: "Preview" }, uploads, objectInfo)[1094].inputs.image_output,
        "Preview");
});

test("server errors retain the rejected input name and allowed options", async context => {
    const original = globalThis.fetch;
    context.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async () => Response.json({ error: { message: "Prompt outputs failed validation" }, node_errors: {
        1073: { class_type: "easy imageColorMatch", errors: [{ message: "Value not in list",
            details: "image_output: 'uploaded.png' not in ['Hide', 'Preview', 'Save', 'Hide/Save']" }] },
    } }, { status: 400 });
    await assert.rejects(queueComfyPrompt("https://provider.example", apiPrompt(), "test"), /1073.*image_output.*uploaded\.png.*Preview/);
});

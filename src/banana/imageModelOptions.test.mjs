import assert from "node:assert/strict";
import { test } from "node:test";
import { openAiImageSizeFields, readModelImageOptions, resolveModelImageSelection } from "./imageModelOptions.js";
import { fetchBananaModels, runBananaImage } from "./bananaApi.js";
import { imageModelKind } from "./imageModelFilter.js";

test("advertised options override the model catalog and stale selections are removed", () => {
    const options = readModelImageOptions({ capabilities: { image: {
        supported_resolutions: ["2k", "2K", "invalid"], supported_aspect_ratios: [" 4:5 ", "4:5", "0:1"],
    } } }, "gemini-3-pro-image", "gemini");
    assert.deepEqual(options, { sizes: ["2K"], ratios: ["4:5"] });
    assert.deepEqual(resolveModelImageSelection(options, { size: "4K", aspectRatio: "16:9" }, "gemini"),
        { size: "", aspectRatio: "", sizes: ["2K"], ratios: ["4:5"] });
    assert.deepEqual(readModelImageOptions({}, "unknown", "gemini"), { sizes: [], ratios: [] });
    assert.deepEqual(readModelImageOptions({ sizes: [] }, "gemini-3-pro-image", "gemini").sizes, []);
    assert.deepEqual(readModelImageOptions({}, "gemini-2.5-flash-image", "gemini").sizes, []);
});

test("OpenAI ratios remain bound to the actual wire size", () => {
    const options = readModelImageOptions({ parameters: { properties: { size: { enum: ["1024x1024", "1024x1536", "2048×3072"] } } } }, "provider-image", "openai");
    assert.deepEqual(options.ratios, ["1:1", "2:3"]);
    assert.deepEqual(resolveModelImageSelection(options, { size: "1024x1024", aspectRatio: "2:3" }, "openai"),
        { size: "1024x1536", aspectRatio: "2:3", sizes: ["1024x1536", "2048x3072"], ratios: ["1:1", "2:3"] });
});

test("provider pull and generation send only the selected fields in the required format", async (context) => {
    const requests = [];
    const fetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = fetch; });
    globalThis.fetch = async (url, options) => {
        if (url.endsWith("/models")) {
            return Response.json({ models: [
                { name: "models/image-a", output_modalities: ["image"], resolutions: ["2K"], ratios: ["4:5"] },
                { name: "models/image-b", task: "text-to-image", imageConfig: { imageSizes: ["1K"], aspectRatios: ["1:1"] } },
                { name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] },
                { name: "models/veo-3-image-to-video", output_modalities: ["image", "video"] },
            ] });
        }
        const payload = options.body instanceof FormData ? Object.fromEntries(options.body) : JSON.parse(options.body);
        requests.push({ url, payload });
        return url.includes(":generateContent")
            ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: "AQID" } }] } }] })
            : Response.json({ data: [{ b64_json: "AQID" }] });
    };
    const config = { baseUrl: "https://provider.example", apiKey: "test-key", protocol: "gemini" };
    const result = await fetchBananaModels(config);
    assert.deepEqual(result.models, ["image-a", "image-b"]);
    assert.deepEqual(result.excludedModels, ["gemini-3-flash", "veo-3-image-to-video"]);
    assert.deepEqual(result.byModel, {
        "image-a": { sizes: ["2K"], ratios: ["4:5"] },
        "image-b": { sizes: ["1K"], ratios: ["1:1"] },
    });
    const base = { model: "image-a", prompt: "test", timeoutMs: 1000 };
    await runBananaImage(config, { ...base, size: "2K", aspectRatio: "4:5" }, []);
    await runBananaImage(config, base, []);
    const openai = { ...config, protocol: "openai" };
    await runBananaImage(openai, { ...base, size: "1024x1536", aspectRatio: "2:3" }, []);
    await runBananaImage(openai, { ...base, size: "1536x1024", aspectRatio: "3:2" }, [{ base64: "AQID" }]);
    assert.deepEqual(requests[0].payload.generationConfig.imageConfig, { imageSize: "2K", aspectRatio: "4:5" });
    assert.equal(requests[1].payload.generationConfig.imageConfig, undefined);
    assert.equal(requests[2].payload.size, "1024x1536");
    assert.equal(requests[2].payload.aspectRatio, undefined);
    assert.match(requests[3].url, /\/images\/edits$/);
    assert.equal(requests[3].payload.size, "1536x1024");
});

test("mixed OpenAI-compatible lists keep only identifiable image-output models", async context => {
    const fetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = fetch; });
    globalThis.fetch = async () => Response.json({ data: [
        { id: "zhiying/doubao-seedream-5-0-pro-260628" },
        { id: "zhiying/gpt-image-2" },
        { id: "zhiying/gpt-image-2.5-sunburst" },
        { id: "zhiying/gpt-image-2.5-flare" },
        { id: "zhiying/gemini-nano-banana-2.1" },
        { id: "zhiying/gpt-5", input_modalities: ["image", "text"], output_modalities: ["text"] },
        { id: "zhiying/kling-image-to-video" },
        { id: "zhiying/doubao-seedance-2-0" },
        { id: "zhiying/qwen-vl-image-caption", output_modalities: ["text"] },
        { id: "zhiying/opaque-alias", capabilities: { image_edit: true } },
        { id: "zhiying/unknown" },
    ] });
    const result = await fetchBananaModels({ baseUrl: "https://provider.example", apiKey: "test-key", protocol: "openai" });
    assert.deepEqual(result.models, [
        "zhiying/doubao-seedream-5-0-pro-260628", "zhiying/gpt-image-2", "zhiying/gpt-image-2.5-sunburst",
        "zhiying/gpt-image-2.5-flare", "zhiying/gemini-nano-banana-2.1", "zhiying/opaque-alias",
    ]);
    assert.deepEqual(Object.keys(result.byModel), result.models);
    assert.equal(result.excludedModels.length, 4);
});

test("manual Gemini Nano Banana IDs are recognized without weakening output checks", () => {
    const id = "zhiying/gemini-nano-banana-2.1";
    assert.equal(imageModelKind(id), "image");
    assert.equal(imageModelKind(id, { output_modalities: ["text", "image"] }), "image");
    assert.equal(imageModelKind(id, { output_modalities: ["text"] }), "non-image");
    assert.equal(imageModelKind("zhiying/gemini-nano-banana-2.1-video"), "non-image");
    assert.equal(imageModelKind("zhiying/gemini-3-flash"), "non-image");
});

test("Zhiying uses model-specific options and defaults to 2K when supported", () => {
    const nano = "zhiying/gemini-nano-banana-2.1";
    const gpt = "zhiying/gpt-image-2.5-sunburst";
    const seedream = "zhiying/doubao-seedream-5-0-pro-260628";
    const cases = [
        [nano, "gemini", ["1K", "2K", "4K"], 14, ""],
        [nano, "openai", ["1K", "2K", "4K"], 14, ""],
        [gpt, "openai", ["1K", "2K", "4K"], 13, "1:1"],
        [seedream, "openai", ["1K", "2K"], 8, ""],
    ];
    for (const [id, protocol, sizes, ratioCount, defaultRatio] of cases) {
        const options = readModelImageOptions({}, id, protocol);
        assert.deepEqual(options.sizes, sizes);
        assert.equal(options.ratios.length, ratioCount);
        const result = resolveModelImageSelection(options, null, protocol);
        assert.equal(result.size, "2K");
        assert.equal(result.aspectRatio, defaultRatio);
        assert.equal(resolveModelImageSelection(options, { size: "1K", aspectRatio: "16:9" }, protocol).size, "1K");
    }
    const restricted = readModelImageOptions({ parameters: { properties: {
        resolution: { enum: ["1K"] }, size: { enum: ["auto", "9:16"] },
    } } }, nano, "openai");
    assert.deepEqual(restricted.sizes, ["1K"]);
    assert.deepEqual(restricted.ratios, ["9:16"]);
    assert.equal(resolveModelImageSelection(restricted, null, "openai").size, "1K");
    assert.equal(resolveModelImageSelection(restricted, { size: "" }, "openai").size, "");
    assert.deepEqual(readModelImageOptions({ sizes: [], ratios: [] }, nano, "openai").sizes, []);
    assert.deepEqual(readModelImageOptions({ sizes: ["1024x1536"] }, gpt, "openai"),
        { sizes: ["1024x1536"], ratios: ["2:3"] });
});

test("Zhiying tiers and ratios use the request encoding for each model", async context => {
    const original = globalThis.fetch;
    context.after(() => { globalThis.fetch = original; });
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push(options.body instanceof FormData ? Object.fromEntries(options.body) : JSON.parse(options.body));
        return String(url).includes(":generateContent")
            ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: "AQID" } }] } }] })
            : Response.json({ data: [{ b64_json: "AQID" }] });
    };
    const nano = "zhiying/gemini-nano-banana-2.1";
    const gpt = "zhiying/gpt-image-2.5-sunburst";
    const seedream = "zhiying/doubao-seedream-5-0-pro-260628";
    for (const [model, protocol, input] of [
        [nano, "gemini"], [nano, "openai", { base64: "AQID" }], [gpt, "openai"], [seedream, "openai"],
    ]) {
        const { openAiSizeMode } = readModelImageOptions(null, model, protocol);
        await runBananaImage({ baseUrl: "https://provider.example", apiKey: "test-key", protocol },
            { model, openAiSizeMode, prompt: "test", size: "2K", aspectRatio: "16:9" }, input);
    }
    assert.deepEqual(requests[0].generationConfig.imageConfig, { imageSize: "2K", aspectRatio: "16:9" });
    assert.equal(requests[1].size, "16:9");
    assert.equal(requests[1].resolution, "2K");
    assert.equal(requests[2].size, "2048x1152");
    assert.equal(requests[2].resolution, undefined);
    assert.equal(requests[3].size, "2816x1584");
    const options = readModelImageOptions(null, gpt, "openai");
    for (const size of options.sizes) for (const aspectRatio of options.ratios) {
        const fields = openAiImageSizeFields({ size, aspectRatio, openAiSizeMode: options.openAiSizeMode });
        const [w, h] = fields.size.split("x").map(Number);
        const [rw, rh] = aspectRatio.split(":").map(Number);
        assert.equal(w * rh, h * rw);
        assert.ok(w % 16 === 0 && h % 16 === 0 && Math.max(w,h) <= 3840 && w*h >= 655360 && w*h <= 8294400);
    }
});

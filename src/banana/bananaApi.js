import { hostFetch, hostFetchFormDataMultiFiles } from "../bridge/hostNetwork.js";
import { readModelImageOptions } from "./imageModelOptions.js";
import { imageModelKind } from "./imageModelFilter.js";

export const GEMINI_IMAGES = "gemini";
export const OPENAI_IMAGES = "openai";

export function resolveBananaRunConfig(config) {
    let url;
    try {
        const address = String(config?.baseUrl || "").trim();
        if (!address) throw new Error();
        url = new URL(address);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
        throw new Error("请填写有效的 HTTP 或 HTTPS API Base URL");
    }

    const apiKey = String(config?.apiKey || "").trim();
    if (!apiKey) throw new Error("请先在账户管理中填写 API Key");
    const protocol = config.protocol === OPENAI_IMAGES ? OPENAI_IMAGES : GEMINI_IMAGES;
    const version = protocol === OPENAI_IMAGES ? "/v1" : "/v1beta";
    let baseUrl = url.href.replace(/\/+$/, "");
    if (!/\/v\d+(?:(?:beta|alpha)\d*)?$/i.test(url.pathname.replace(/\/+$/, ""))) baseUrl += version;
    return { ...config, baseUrl, apiKey, protocol, endpointLabel: url.host };
}

function headers({ baseUrl, apiKey, protocol }) {
    const requestHeaders = { "Content-Type": "application/json" };
    if (protocol === GEMINI_IMAGES && new URL(baseUrl).hostname === "generativelanguage.googleapis.com") {
        requestHeaders["x-goog-api-key"] = apiKey;
    } else {
        requestHeaders.Authorization = `Bearer ${apiKey}`;
    }
    return requestHeaders;
}

function responseJson(response, apiKey) {
    let json;
    try { json = JSON.parse(response?.body || ""); }
    catch { json = null; }
    if (!response?.ok || json?.error) {
        const detail = json?.error?.message || json?.message || "";
        const message = String(detail).replaceAll(apiKey, "[已隐藏]");
        throw new Error(message || `供应商请求失败（HTTP ${response?.status || 0}）`);
    }
    if (!json) throw new Error("供应商未返回有效的 JSON");
    return json;
}

export async function fetchBananaModels(config) {
    const checked = resolveBananaRunConfig(config);
    const { baseUrl, apiKey, protocol } = checked;
    const start = Date.now();
    const response = await hostFetch(`${baseUrl}/models`, { headers: headers(checked), timeoutMs: 15000 });
    const json = responseJson(response, apiKey);
    const list = protocol === OPENAI_IMAGES ? json.data : json.models;
    if (!Array.isArray(list)) throw new Error("供应商未返回模型列表，可在账户管理中手动填写模型 ID");
    const excluded = new Set();
    const byModel = Object.fromEntries(list.flatMap(item => {
        const id = String(typeof item === "string" ? item : item?.id || item?.name || "").replace(/^models\//, "").trim();
        if (!id) return [];
        const kind = imageModelKind(id, item);
        if (kind === "image") return [[id, readModelImageOptions(item, id, protocol)]];
        if (kind === "non-image") excluded.add(id);
        return [];
    }));
    const models = Object.keys(byModel);
    const excludedModels = [...excluded].filter(id => !Object.hasOwn(byModel, id));
    return { models, byModel, excludedModels, endpointLabel: checked.endpointLabel, latencyMs: Date.now() - start };
}

function dataImage(base64, mimeType = "image/png") {
    return `data:${mimeType};base64,${base64}`;
}

function geminiResults(json) {
    return (json.candidates || []).flatMap((candidate) =>
        (candidate.content?.parts || []).flatMap((part) => {
            const image = part.inlineData || part.inline_data;
            return image?.data ? [dataImage(image.data, image.mimeType || image.mime_type)] : [];
        })
    );
}

async function runGemini(config, task, images) {
    const parts = [
        { text: task.prompt },
        ...images.map((image) => ({ inlineData: { mimeType: image.mimeType || "image/png", data: image.base64 } })),
    ];
    const imageConfig = {
        ...(task.size ? { imageSize: task.size } : {}),
        ...(task.aspectRatio ? { aspectRatio: task.aspectRatio } : {}),
    };
    const response = await hostFetch(`${config.baseUrl}/models/${encodeURIComponent(task.model)}:generateContent`, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
        }),
        timeoutMs: task.timeoutMs,
    });
    return geminiResults(responseJson(response, config.apiKey));
}

async function runOpenAi(config, task, images) {
    const { baseUrl, apiKey } = config;
    const fields = { model: task.model, prompt: task.prompt, n: 1, ...(task.size ? { size: task.size } : {}) };
    const response = images.length
        ? await hostFetchFormDataMultiFiles(
            `${baseUrl}/images/edits`,
            fields,
            images.map((image) => ({ ...image, field: "image[]" })),
            headers(config),
        )
        : await hostFetch(`${baseUrl}/images/generations`, {
            method: "POST",
            headers: headers(config),
            body: JSON.stringify(fields),
            timeoutMs: task.timeoutMs,
        });
    const json = responseJson(response, apiKey);
    return (json.data || []).flatMap((item) => {
        if (item.b64_json) return [dataImage(item.b64_json)];
        return /^https?:\/\//i.test(item.url || "") ? [item.url] : [];
    });
}

export async function runBananaImage(config, task, imageOrImages) {
    const checked = resolveBananaRunConfig(config);
    const normalizedTask = { ...task, prompt: String(task.prompt || "").trim() };
    if (!normalizedTask.prompt) throw new Error("请填写提示词");
    if (!normalizedTask.model) throw new Error("请在账户管理中填写或选择模型");
    const images = (Array.isArray(imageOrImages) ? imageOrImages : [imageOrImages]).filter((image) => image?.base64);
    const result = checked.protocol === OPENAI_IMAGES
        ? await runOpenAi(checked, normalizedTask, images)
        : await runGemini(checked, normalizedTask, images);
    if (!result.length) throw new Error("供应商未返回图片，请确认使用支持图片输出的模型");
    return result;
}

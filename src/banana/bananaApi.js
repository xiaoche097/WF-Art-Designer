import { hostFetch, hostFetchFormDataMultiFiles } from "../bridge/hostNetwork.js";
import { openAiImageSizeFields, readModelImageOptions } from "./imageModelOptions.js";
import { imageModelKind } from "./imageModelFilter.js";
import { bananaCancelled, retryBananaOperation, waitBanana } from "./bananaRetry.js";

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

function bananaResponseError(response, payload, apiKey, { polling = false } = {}) {
    const issue = payload?.error || payload;
    const status = Number(response?.status || 0);
    const code = String(issue?.code ?? issue?.status ?? issue?.type ?? "");
    const detail = issue?.message || (typeof issue === "string" ? issue : "") || response?.statusText || "";
    const clean = String(detail).replaceAll(apiKey, "[已隐藏]");
    const credentials = [401, 403].includes(status) || /^(?:401|403|authentication_error|invalid_token|permission_denied)$/i.test(code) ||
        /(?:api[ _-]?key|access[ _-]?token).{0,30}(?:invalid|incorrect|expired|missing|revoked)|(?:invalid|incorrect|expired|missing|revoked).{0,30}(?:api[ _-]?key|access[ _-]?token)|unauthenticated|unauthorized|密钥.{0,12}(?:无效|错误|过期|缺失)|(?:无效|错误|过期).{0,12}(?:密钥|API\s*Key)/i.test(`${code} ${clean}`);
    const transport = [0, 408, 504].includes(status);
    const problem = `${code} ${clean}`;
    const permanent = [402, 404, 405, 413, 415, 422].includes(status) ||
        /insufficient[_ -]?(?:quota|balance|credits)|payment[_ -]?required|billing[_ -]?(?:limit|hard)|content[_ -]?(?:policy|filter|violation)|moderation[_ -]?blocked|\b(?:safety|violation|recitation|cancelled|canceled)\b|余额不足|欠费|内容违规|安全过滤/i.test(problem);
    const temporary = /\bbusy\b|overload|rate[_ -]?limit|temporar|capacity|稍后|繁忙|限流/i.test(problem);
    return Object.assign(new Error(clean || `供应商请求失败（HTTP ${status}）`), {
        status, retryable: !credentials && !permanent && (polling || !transport) && (status !== 400 || temporary),
    });
}

function responseJson(response, apiKey, { polling = false } = {}) {
    let json;
    try { json = JSON.parse(response?.body || ""); }
    catch { json = null; }
    const businessStatus = Number(json?.code);
    if (polling && response?.ok && terminalTaskFailure.test(imageTask(json).status)) return json;
    if (!response?.ok || json?.error || json?.success === false || businessStatus >= 400 && businessStatus < 600) {
        const status = response?.ok && businessStatus >= 400 && businessStatus < 600 ? businessStatus : response?.status;
        throw bananaResponseError({ ...response, status }, json, apiKey, { polling });
    }
    if (!json) throw new Error("供应商未返回有效的 JSON");
    return json;
}

async function bananaNetwork(request, signal, { polling = false } = {}) {
    if (signal?.aborted) throw bananaCancelled();
    try {
        return await request();
    } catch (error) {
        if (signal?.aborted) throw bananaCancelled();
        throw Object.assign(new Error(error?.message || "网络请求失败"), { retryable: polling });
    }
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

function openAiResults(json) {
    const data = Array.isArray(json?.data) ? json.data : [];
    return data.flatMap(item => {
        if (item?.b64_json) return [dataImage(item.b64_json)];
        return /^https?:\/\//i.test(item?.url || "") ? [item.url] : [];
    });
}

const pendingTask = /^(?:submitted|pending|queued|processing|in_progress|running|accepted)$/;
const terminalTaskFailure = /^(?:fail|failed|error|cancelled|canceled|expired|rejected|violation|blocked)$/;

function imageTask(json) {
    const data = Array.isArray(json?.data) ? json.data[0] : json?.data;
    const item = data && typeof data === "object" ? { ...json, ...data } : json;
    const status = String(item?.status || item?.state || "").toLowerCase();
    const id = item?.task_id ?? item?.taskId ??
        (pendingTask.test(status) ? item?.id : null);
    return { item, status, id: id == null ? "" : String(id), path: item?.poll_url ?? item?.status_url };
}

function bananaResultImages(json, readImages) {
    const { item } = imageTask(json);
    const direct = readImages(json);
    if (direct.length) return direct;
    const result = item?.result;
    const nested = readImages(result || {});
    if (nested.length) return nested;
    const listed = openAiResults({ data: item?.results || result?.results });
    if (listed.length) return listed;
    const url = item?.image_url ?? result?.url ?? result?.image_url;
    return /^https?:\/\//i.test(url || "") ? [url] : [];
}

async function collectBananaImages(json, readImages, config, task, httpStatus) {
    const immediate = bananaResultImages(json, readImages);
    if (immediate.length) return immediate;
    const initial = imageTask(json);
    if (!initial.id && !initial.path) {
        if (httpStatus === 202 || pendingTask.test(initial.status)) {
            throw Object.assign(new Error("供应商已接收任务，但没有返回任务 ID 或查询地址"), { retryable: false });
        }
        return [];
    }

    const { signal, timeoutMs } = task;
    const base = new URL(config.baseUrl + "/");
    const taskId = encodeURIComponent(initial.id);
    const routes = initial.path ? [initial.path]
        : [`images/tasks/${taskId}`, `tasks/${taskId}`];
    let route;
    while (true) {
        task.onPoll?.();
        await waitBanana(3000, signal);
        const candidates = route ? [route] : routes;
        let polled;
        for (const path of candidates) {
            let url;
            try { url = new URL(path, base); } catch (_) {}
            if (!url || url.origin !== base.origin || url.username || url.password) {
                throw Object.assign(new Error("供应商返回了不受支持的任务查询地址"), { retryable: false });
            }
            polled = await retryBananaOperation(async () => {
                const response = await bananaNetwork(
                    () => hostFetch(url.href, { headers: headers(config), timeoutMs, signal, hostTimeoutBufferMs: 0 }), signal, { polling: true });
                if ([404, 405].includes(response.status) && !route) return null;
                return responseJson(response, config.apiKey, { polling: true });
            }, { signal, onRetry: task.onPollRetry });
            if (polled) { route = path; break; }
        }
        if (!polled) throw Object.assign(new Error(`供应商已接收任务 ${initial.id}，但未提供可用的查询接口`), { retryable: false });
        const images = bananaResultImages(polled, readImages);
        if (images.length) return images;
        const { item, status } = imageTask(polled);
        if (terminalTaskFailure.test(status)) {
            const failure = bananaResponseError({ status: Number(item?.http_status) || 200 }, item, config.apiKey);
            if (/^(?:cancelled|canceled|expired|rejected|violation|blocked)$/.test(status)) failure.retryable = false;
            throw failure;
        }
    }
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
    const response = await bananaNetwork(() => hostFetch(`${config.baseUrl}/models/${encodeURIComponent(task.model)}:generateContent`, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
        }),
        timeoutMs: task.timeoutMs,
        hostTimeoutBufferMs: 0,
        signal: task.signal,
    }), task.signal);
    const json = responseJson(response, config.apiKey);
    const block = json.promptFeedback?.blockReason ||
        json.candidates?.find(candidate => /^(?:SAFETY|IMAGE_SAFETY|PROHIBITED_CONTENT|RECITATION|BLOCKLIST)$/i.test(candidate.finishReason))?.finishReason;
    if (block && !geminiResults(json).length) {
        throw Object.assign(new Error("供应商内容审核拦截，请调整提示词或参考图"), { retryable: false });
    }
    return collectBananaImages(json, geminiResults, config, task, response.status);
}

async function runOpenAi(config, task, images) {
    const { baseUrl, apiKey } = config;
    const fields = { model: task.model, prompt: task.prompt, n: 1, ...openAiImageSizeFields(task) };
    const options = { timeoutMs: task.timeoutMs, hostTimeoutBufferMs: 0, signal: task.signal };
    const response = await bananaNetwork(() => images.length
        ? hostFetchFormDataMultiFiles(
            `${baseUrl}/images/edits`,
            fields,
            images.map((image) => ({ ...image, field: "image[]" })),
            headers(config),
            options,
        )
        : hostFetch(`${baseUrl}/images/generations`, {
            method: "POST",
            headers: headers(config),
            body: JSON.stringify(fields),
            ...options,
        }), task.signal);
    return collectBananaImages(responseJson(response, apiKey), openAiResults, config, task, response.status);
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

export async function runBananaImageUntilComplete(config, task, images, { onRetry, wait } = {}) {
    const checked = resolveBananaRunConfig(config);
    if (!String(task.prompt || "").trim()) throw new Error("请填写提示词");
    if (!task.model) throw new Error("请在账户管理中填写或选择模型");
    return retryBananaOperation(() => runBananaImage(checked, task, images), { signal: task.signal, onRetry, wait });
}

export async function runBananaVision(config, { model, prompt, images, signal }) {
    const checked = resolveBananaRunConfig(config);
    const gemini = checked.protocol === GEMINI_IMAGES;
    const endpoint = gemini ? `models/${encodeURIComponent(model)}:generateContent` : "chat/completions";
    const body = gemini ? {
        contents: [{ role: "user", parts: [
            { text: prompt },
            ...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
        ] }],
    } : {
        model,
        messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            ...images.map(image => ({ type: "image_url", image_url: { url: dataImage(image.base64, image.mimeType) } })),
        ] }],
    };
    const response = await bananaNetwork(() => hostFetch(`${checked.baseUrl}/${endpoint}`, {
        method: "POST", headers: headers(checked), body: JSON.stringify(body), timeoutMs: 90000, signal,
    }), signal);
    const data = responseJson(response, checked.apiKey);
    const content = gemini
        ? data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || "").join("")
        : data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("视觉模型没有返回分析文字");
    return content;
}

import { hostFetch, hostFetchFormData } from "../bridge/hostNetwork.js";
import { fetchProxyFormDataFromUploadSession, wfArtAssistantReleaseUploadSession } from "../bridge/uxpBridge.js";
import { captureAll } from "../components/ImageUpload/captureUtils.js";
import { stripBase64FromDataUrl } from "../runninghub/ui/wfaRhWorkPanelLogic.js";

export const ecomGenOrigin = "http://127.0.0.1:8787";

export function ecomGenProjectPath(projectId) {
    return `/projects/${encodeURIComponent(projectId)}`;
}

function responseData(response) {
    let data;
    try { data = JSON.parse(response.body); } catch (_) {
        throw new Error(`EcomGen 返回了无效响应（HTTP ${response.status}）`);
    }
    if (!response.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw new Error(`EcomGen：${detail}`);
    }
    return data;
}

async function get(path) {
    return responseData(await hostFetch(ecomGenOrigin + path, { timeoutMs: 5000 }));
}

export async function listEcomGenProjects() {
    const result = await get("/api/v1/projects");
    if (!Array.isArray(result?.items)) throw new Error("EcomGen 项目列表格式不正确");
    return result.items;
}

export async function readEcomGenOutputs(projectId) {
    const project = await get(`/api/v1${ecomGenProjectPath(projectId)}`);
    if (!Array.isArray(project?.outputs)) throw new Error("EcomGen 项目成片列表格式不正确");
    const itemTitles = new Map((project.items || []).map(item => [item.id, item.displayName]));
    return project.outputs.map(output => ({
        ...output,
        title: itemTitles.get(output.storyboardItemId) || "成片",
    }));
}

export function ecomGenOutputUrl(outputId) {
    return `${ecomGenOrigin}/api/v1/files/outputs/${encodeURIComponent(outputId)}`;
}

export async function uploadPhotoshopToEcomGen(projectId, kind) {
    const capture = await captureAll("canvas", {
        longEdgeMax: 4096,
        uploadEncodeFormat: "png",
        __retainUploadSession: true,
    });
    const url = `${ecomGenOrigin}/api/v1${ecomGenProjectPath(projectId)}/assets`;
    const fileName = `Photoshop-${Date.now()}.png`;
    const mime = capture.mimeType || "image/png";
    const sessionId = capture.uploadSessionId;
    if (sessionId) {
        try {
            return responseData(await fetchProxyFormDataFromUploadSession(url, { kind }, sessionId, fileName, mime));
        } finally {
            await wfArtAssistantReleaseUploadSession(sessionId).catch(error => console.warn("EcomGen 释放捕获会话失败", error));
        }
    }
    const base64 = stripBase64FromDataUrl(capture.uploadBase64 || "");
    if (!base64) throw new Error("Photoshop 捕获结果为空");
    return responseData(await hostFetchFormData(url, { kind }, base64, fileName, mime));
}

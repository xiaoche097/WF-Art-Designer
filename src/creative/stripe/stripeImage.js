import { captureAll } from "../../components/ImageUpload/captureUtils.js";
import { wfArtAssistantPeekUploadSessionRawBase64, wfArtAssistantReleaseUploadSession } from "../../bridge/uxpBridge.js";

export async function decodeStripeImage(url, width, height) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
        frame: ctx.getImageData(0, 0, canvas.width, canvas.height),
        sourceWidth: width || image.naturalWidth,
        sourceHeight: height || image.naturalHeight,
    };
}

export async function loadStripeFile(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error("图片超过 20 MB");
    const url = URL.createObjectURL(file);
    try { return await decodeStripeImage(url); }
    finally { URL.revokeObjectURL(url); }
}

export async function captureStripeImage(scope) {
    const capture = await captureAll(scope === "layer" ? "layer" : "canvas", {
        longEdgeMax: 1024, requireSelection: scope === "selection",
        ignoreSelection: scope !== "selection",
        uploadEncodeFormat: "png", __retainUploadSession: true,
    });
    try {
        const data = await wfArtAssistantPeekUploadSessionRawBase64(capture.uploadSessionId);
        if (!data?.ok || !data.rawBase64) throw new Error("Photoshop 未返回取样图像");
        const bounds = capture.bounds;
        const width = bounds && Number(bounds.right) - Number(bounds.left);
        const height = bounds && Number(bounds.bottom) - Number(bounds.top);
        return await decodeStripeImage(`data:${capture.mimeType};base64,${data.rawBase64}`, width, height);
    } finally {
        await wfArtAssistantReleaseUploadSession(capture.uploadSessionId).catch(error => console.warn("释放条纹取样会话失败", error));
    }
}

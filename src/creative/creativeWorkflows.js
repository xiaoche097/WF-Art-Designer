import { readCompatLocalStorage } from "../utils/storageKeyCompat.js";
import { referenceFromFile } from "../retouch/recolorImages.js";
import { storage } from "../bridge/uxpShim.js";
import { readModelImageOptions, resolveModelImageSelection } from "../banana/imageModelOptions.js";

export const reversePrompt = `将依次输入的电商参考图拆成可复用的套图模板。一张图对应一条分镜，顺序与输入一致。
归纳整套的布局、色温、用光、字体层级、留白与节奏。逐图说明镜头、布景、主体位置与留字区。
替换商品时必须保持新商品的实物特征。不要抄参考图的品牌、人物身份、文案、标识或未经确认的卖点。
只输出 JSON 对象，结构为 {"name":"模板名称","style":"全套视觉方向","shots":[{"title":"分镜名","prompt":"这一镜的可执行生图指令"}]}。`;

export function parseReverseSuite(text, count) {
    const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let result;
    try { result = JSON.parse(raw); }
    catch { throw new Error("视觉模型未返回有效的套图 JSON，请重试或更换模型"); }
    const name = typeof result?.name === "string" ? result.name.trim().slice(0, 80) : "";
    const style = typeof result?.style === "string" ? result.style.trim().slice(0, 2000) : "";
    if (!name || !style || !Array.isArray(result.shots) || result.shots.length !== count) {
        throw new Error("返回的套图模板不完整，分镜数量应与参考图一致");
    }
    const shots = result.shots.map((item, index) => {
        if (typeof item?.prompt !== "string" || !item.prompt.trim()) throw new Error(`第 ${index + 1} 张缺少分镜提示词`);
        return { id: `shot-${index + 1}`, title: String(item.title || `分镜 ${index + 1}`).slice(0, 100), prompt: item.prompt.trim().slice(0, 5000) };
    });
    return { name, style, shots };
}

export function readCreativeProfile() {
    const read = key => JSON.parse(readCompatLocalStorage(key) || "null");
    const selected = read("banana_provider");
    const profiles = read("banana_custom_providers");
    return (Array.isArray(profiles) ? profiles.find(item => item.id === selected) : null) || read("banana_zhiying_profile");
}

export function creativeImageTask(profile, prompt, signal) {
    const model = String(profile?.model || "").trim();
    const options = readModelImageOptions(null, model, profile?.protocol);
    return {
        ...resolveModelImageSelection(options, profile?.imageOptionsByModel?.[model], profile?.protocol),
        openAiSizeMode: options.openAiSizeMode, model, prompt, signal, timeoutMs: 180000,
    };
}

export async function prepareCreativeImage(file, maxEdge = 1024) {
    const frame = await referenceFromFile(file, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d").putImageData(frame, 0, 0);
    const url = canvas.toDataURL("image/png");
    return { url, mimeType: "image/png", base64: url.split(",")[1], fileName: file.name.replace(/\.[^.]+$/, "") + ".png" };
}

let folderRequest;
export function creativeAssetFolder() {
    if (!folderRequest) folderRequest = (async () => {
        const root = await storage.localFileSystem.getDataFolder();
        const folderName = "creative_assets";
        const entries = await root.getEntries();
        return entries.some(entry => entry.name === folderName)
            ? root.getEntry(folderName) : root.createFolder(folderName);
    })().catch(error => {
        folderRequest = null;
        throw error;
    });
    return folderRequest;
}

export async function creativeAssetReference(asset) {
    const folder = await creativeAssetFolder();
    const file = await folder.getEntry(asset.fileName);
    const bytes = await file.read({ format: storage.formats.binary });
    const extension = asset.fileName.split(".").at(-1).toLowerCase();
    const mimeType = `image/${extension === "jpg" ? "jpeg" : extension}`;
    return prepareCreativeImage(new File([bytes], asset.fileName, { type: mimeType }));
}

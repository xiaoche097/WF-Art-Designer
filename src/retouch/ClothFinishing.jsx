import React, { useEffect, useMemo, useRef, useState } from "react";
import { runBananaImage, resolveBananaRunConfig } from "../banana/bananaApi.js";
import { readCompatLocalStorage } from "../utils/storageKeyCompat.js";
import { hostFetch } from "../bridge/hostNetwork.js";
import { composite } from "../../plugin/host/retouch/clothComposite.js";

const tools = [
    ["debris", "去毛球与灰尘", "Remove isolated lint, hairs, pills and small dust specks without removing weave, print or seams."],
    ["sweat", "去汗渍", "Remove only localized sweat darkening. Restore nearby fabric color and preserve lighting, seams, folds and texture."],
    ["edge", "衣缘修整", "Tidy wrinkles and irregularities just inside the garment edge. Keep the original silhouette and bordering objects fixed."],
    ["garment", "AI 衣物精修", "Clean up garment folds and small defects. Preserve weave, material, print, cut and colors. Do not redesign the garment."],
    ["volume", "裙子蓬松", "Make the skirt look fuller through folds, shading and drape within its original contour. Do not extend its silhouette."],
    ["hem", "裙摆平整", "Smooth the skirt hem and its nearby folds while keeping the existing skirt silhouette fixed."],
    ["shoes", "鞋面去污", "Clean the existing shoes only. Restore the original material, color, details and shoe outlines."],
];

function readProfile() {
    const get = key => JSON.parse(readCompatLocalStorage(key) || "null");
    const selected = get("banana_provider");
    const custom = get("banana_custom_providers");
    const profile = (Array.isArray(custom) ? custom.find(item => item.id === selected) : null) || get("banana_zhiying_profile");
    if (!profile?.model) throw Error("请先在织影账户管理中配置支持图片编辑的模型");
    return resolveBananaRunConfig(profile);
}

function regionFor(tool, source, mask) {
    if (tool === "shoes") return source.approvedShoes;
    if (tool === "hem" || tool === "volume") return mask && Uint8Array.from(mask, (value, i) =>
        source.regions[i] === 3 || source.regions[i] === 5 ? value : 0);
    if (tool === "edge" && mask) {
        const { width, height } = source.frame;
        const dx = Math.max(2, Math.round(Math.max(width, height) * .012));
        return Uint8Array.from(mask, (value, p) => {
            if (!value) return 0;
            const x = p % width, y = Math.floor(p / width);
            const safe = source.approvedClothing;
            return x < dx || x + dx >= width || y < dx || y + dx >= height ||
                !safe[p - dx] || !safe[p + dx] || !safe[p - dx * width] || !safe[p + dx * width] ? value : 0;
        });
    }
    return mask;
}

function put(canvas, pixels, width, height) {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const data = context.createImageData(width, height);
    data.data.set(pixels);
    context.putImageData(data, 0, 0);
}

async function generate(tool, frame, mask, profile) {
    const { width, height, pixels } = frame;
    const input = new Uint8ClampedArray(pixels.length);
    input.fill(255);
    for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        input.set(pixels.subarray(p * 4, p * 4 + 4), p * 4);
    }
    const cutout = document.createElement("canvas");
    put(cutout, input, width, height);
    const canvas = document.createElement("canvas");
    const edge = 640;
    canvas.width = canvas.height = edge;
    const scale = Math.min(edge / width, edge / height);
    const w = Math.round(width * scale), h = Math.round(height * scale);
    const x = Math.floor((edge - w) / 2), y = Math.floor((edge - h) / 2);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, edge, edge);
    context.drawImage(cutout, x, y, w, h);
    const [, , task] = tool;
    const prompt = `Edit the visible target garment or shoes only. ${task} Keep the square canvas, exact framing and pixel alignment. Leave the white space unchanged. Return the whole square canvas without cropping or text.`;
    const [result] = await runBananaImage(profile, { model: profile.model, prompt, timeoutMs: 120000 },
        { mimeType: "image/png", base64: canvas.toDataURL("image/png").split(",")[1], filename: "cloth.png" });
    let data = result;
    if (!result.startsWith("data:")) {
        const reply = await hostFetch(result, { returnBinary: true, timeoutMs: 30000 });
        if (!reply.ok || !reply.bodyBase64 || !/^image\/(png|jpeg|webp)/i.test(reply.contentType || "")) throw Error("无法下载修复结果");
        data = `data:${reply.contentType.split(";")[0]};base64,${reply.bodyBase64}`;
    }
    const image = new Image();
    image.src = data;
    await image.decode();
    const size = image.naturalWidth;
    if (size < 256 || size !== image.naturalHeight) throw Error("模型未返回可对齐的方形图片，已停止写入");
    cutout.width = width;
    cutout.height = height;
    const output = cutout.getContext("2d");
    const ratio = size / edge;
    output.drawImage(image, x * ratio, y * ratio, w * ratio, h * ratio, 0, 0, width, height);
    return output.getImageData(0, 0, width, height).data;
}

export function ClothFinishing({ source, mask, disabled, onWrite }) {
    const [choice, setChoice] = useState(tools[0][0]);
    const [armed, setArmed] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [generated, setGenerated] = useState(null);
    const [strength, setStrength] = useState(100);
    const [original, setOriginal] = useState(false);
    const canvas = useRef(null);
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);
    const region = useMemo(() => regionFor(choice, source, mask), [choice, source, mask]);
    const activeMask = useMemo(() => generated && Uint8Array.from(generated.region, value => Math.round(value * strength / 100)), [generated, strength]);
    useEffect(() => {
        if (!canvas.current || !generated) return;
        const { width, height, pixels } = source.frame;
        put(canvas.current, original ? pixels : composite(pixels, generated.pixels, activeMask), width, height);
    }, [source, generated, activeMask, original]);

    async function submit() {
        const { profile, region } = armed;
        setArmed(null);
        setBusy(true);
        setError("");
        setGenerated(null);
        try {
            const pixels = await generate(tools.find(tool => tool[0] === choice), source.frame, region, profile);
            if (alive.current) setGenerated({ pixels, region, scope: choice === "shoes" ? "shoes" : "clothing" });
        } catch (problem) {
            if (alive.current) setError(problem.message);
        } finally {
            if (alive.current) setBusy(false);
        }
    }

    return <details className="wfa-cloth-advanced">
        <summary>局部修复 · AI</summary>
        <label className="wfa-retouch-field">修复项目
            <select value={choice} disabled={busy || disabled} onChange={event => {
                setChoice(event.target.value); setGenerated(null); setArmed(null); setError("");
            }}>
                {tools.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
            </select>
        </label>
        {!region?.some(Boolean) && <p className="wfa-retouch-hint">当前图未识别到此工具的目标区域。</p>}
        {choice === "sweat" && <p className="wfa-retouch-hint">可以先用高级蒙版缩小到汗渍位置。</p>}
        {["volume", "hem", "edge"].includes(choice) && <p className="wfa-retouch-hint">效果限定在原有衣物轮廓内。</p>}
        {!armed && <button type="button" disabled={disabled || busy || !region?.some(Boolean)} onClick={() => {
            setError("");
            try { setArmed({ profile: readProfile(), region }); }
            catch (problem) { setError(problem.message); }
        }}>{busy ? "正在生成局部效果…" : "准备局部预览"}</button>}
        {armed && <div className="wfa-retouch-actions">
            <p>只发送已选区域内的图像像素至 {armed.profile.endpointLabel}。</p>
            <button type="button" onClick={() => setArmed(null)}>取消</button>
            <button type="button" disabled={disabled || armed.region !== region} onClick={submit}>发送并生成</button>
        </div>}
        {generated && <>
            <label className="wfa-cloth-strength">局部修复强度 {strength}%
                <input type="range" min="0" max="100" value={strength} onChange={event => setStrength(Number(event.target.value))} />
            </label>
            <button type="button" aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? "看修复图" : "看原图"}</button>
            <canvas ref={canvas} aria-label="局部修复预览" />
            <button className="wfa-retouch-primary" type="button"
                disabled={disabled || busy || !strength || generated.region !== region}
                onClick={() => onWrite(generated.pixels, activeMask, generated.scope)}>生成局部修复图层到 Photoshop</button>
        </>}
        {error && <p role="alert" className="wfa-retouch-notice" data-error>{error}</p>}
    </details>;
}

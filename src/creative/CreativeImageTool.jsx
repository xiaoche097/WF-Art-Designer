import React, { useEffect, useRef, useState } from "react";
import { runBananaImage } from "../banana/bananaApi.js";
import { isInWebView, photoshop, wfArtAssistantPeekUploadSessionRawBase64, wfArtAssistantReleaseUploadSession } from "../bridge/uxpBridge.js";
import { captureAll } from "../components/ImageUpload/captureUtils.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { getTempResultFolder, saveImageWithBounds } from "../utils/imageSaver.js";
import { creativeAssetFolder, creativeAssetReference, prepareCreativeImage } from "./creativeWorkflows.js";

export async function placeCreativeResult(url) {
    const doc = await photoshop.app.getActiveDocument();
    if (doc?.id == null) throw new Error("请先打开要接收结果的 Photoshop 文档");
    const folder = await getTempResultFolder();
    if (!folder?.token) throw new Error("Photoshop 缓存目录不可用");
    const file = await saveImageWithBounds(folder, url, 1, { runningHubAppName: "创意中心", docId: doc.id });
    await performAutoPlace([file.fileName], "创意中心", null, folder.token, doc.id, { force: true, group: false });
}

export function CreativeImageTool({ label, prompt, asset, onSaved, assetType, onInspect, onApprove, imageRequestRef, requireReference = false }) {
    const inPhotoshop = isInWebView();
    const [reference, setReference] = useState(null);
    const [outputs, setOutputs] = useState([]);
    const [output, setOutput] = useState("");
    const [resultLabel, setResultLabel] = useState("");
    const [resultPrompt, setResultPrompt] = useState("");
    const [busy, setBusy] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const lock = useRef(false);
    const controller = useRef(null);
    useEffect(() => () => controller.current?.abort(), []);

    async function run(message, action) {
        if (lock.current) return;
        lock.current = true;
        setBusy(message);
        setStatus("");
        setError("");
        try { await action(); }
        catch (failure) { setError(failure?.message || failure?.reason || String(failure)); }
        finally { lock.current = false; setBusy(""); }
    }

    function generate() {
        return run("正在使用织影生成…", async () => {
            const imageRequest = imageRequestRef.current;
            if (!imageRequest?.task.model) throw new Error("请先在织影中选择可用的图像模型");
            const request = new AbortController();
            controller.current = request;
            try {
                const images = [];
                if (reference) images.push(reference);
                if (asset) images.push(await creativeAssetReference(asset));
                const task = { ...imageRequest.task, prompt, signal: request.signal };
                const next = await runBananaImage(imageRequest.config, task, images);
                if (request.signal.aborted) return;
                setOutputs(next);
                setOutput(next[0]);
                setResultLabel(label);
                setResultPrompt(task.prompt);
            } catch (failure) {
                if (!request.signal.aborted) throw failure;
            } finally {
                if (request.signal.aborted) setStatus("已取消生成。");
                controller.current = null;
            }
        });
    }

    function save(url, type, name, approve = false) {
        return run(approve ? "正在保存审核成片…" : "正在保存素材…", async () => {
            const folder = await creativeAssetFolder();
            const saved = await saveImageWithBounds(folder, url, 1, { runningHubAppName: "创意中心" });
            onSaved({ id: saved.fileName, fileName: saved.fileName, type, name });
            if (approve) onApprove({ fileName: saved.fileName, prompt: resultPrompt, approvedAt: new Date().toISOString() });
            setStatus(approve ? "成片已通过审核。" : "已保存到创意中心素材库。");
        });
    }

    function captureReference() {
        return run("正在读取 Photoshop 画面…", async () => {
            const captured = await captureAll("canvas", { longEdgeMax: 1024, uploadEncodeFormat: "png", __retainUploadSession: true });
            const { uploadSessionId, mimeType, previewBase64 } = captured;
            try {
                const reply = await wfArtAssistantPeekUploadSessionRawBase64(uploadSessionId);
                if (!reply?.ok || !reply.rawBase64) throw new Error("Photoshop 未返回可用图片");
                setReference({ url: previewBase64, mimeType, base64: reply.rawBase64, fileName: "Photoshop.png" });
            } finally {
                await wfArtAssistantReleaseUploadSession(uploadSessionId).catch(error => console.warn("释放创意参考图会话失败", error));
            }
        });
    }

    return <section className="wfa-creative-card" aria-label={label}>
        <h3>{label}</h3>
        <label>导入参考图
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void run("正在读取参考图…", async () => setReference(await prepareCreativeImage(file)));
            }} />
        </label>
        {inPhotoshop && <button type="button" disabled={Boolean(busy)} onClick={captureReference}>读取 Photoshop 画面</button>}
        {asset && <p>已选素材库参考图 · {asset.name}</p>}
        {reference && <div className="wfa-creative-reference">
            <img src={reference.url} alt="当前参考图" />
            <button type="button" disabled={Boolean(busy)} onClick={() => setReference(null)}>移除参考图</button>
        </div>}
        <button type="button" className="wfa-creative-primary"
            disabled={!prompt.trim() || Boolean(busy) || (requireReference && !reference && !asset)} onClick={generate}>使用织影生成</button>
        {busy === "正在使用织影生成…" && <button type="button" onClick={() => controller.current?.abort()}>取消生成</button>}
        {(busy || status) && <p role="status">{busy || status}</p>}
        {error && <p role="alert">{error}</p>}
        {output && <>
            {outputs.length > 1 && <label>候选成片<select value={output} onChange={event => setOutput(event.target.value)}>
                {outputs.map((url, index) => <option key={index} value={url}>候选 {index + 1}</option>)}
            </select></label>}
            <img className="wfa-creative-result" src={output} alt={resultLabel + "成片预览"} />
            {onInspect && <button type="button" disabled={Boolean(busy)} onClick={() => onInspect(output, resultLabel)}>检查成片接缝</button>}
            {onApprove && inPhotoshop && <button type="button" className="wfa-creative-primary" disabled={Boolean(busy)}
                onClick={() => save(output, assetType, resultLabel, true)}>通过审核</button>}
            {inPhotoshop && <div className="wfa-creative-buttons">
                <button type="button" disabled={Boolean(busy)} onClick={() => save(output, assetType, resultLabel)}>存入素材库</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => run("正在置入图层…", async () => {
                    await placeCreativeResult(output);
                    setStatus("已置入 Photoshop 独立图层。");
                })}>置入 Photoshop</button>
            </div>}
        </>}
    </section>;
}

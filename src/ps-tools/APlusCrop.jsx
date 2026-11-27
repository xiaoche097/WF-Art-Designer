import React, { useState } from "react";
import { invoke, wfArtAssistantReleaseUploadSession } from "../bridge/uxpBridge.js";
import { storage } from "../bridge/uxpShim.js";
import { captureAll } from "../components/ImageUpload/captureUtils.js";
import { createCreativeZip } from "../../plugin/host/creativeZip.js";
import { A_PLUS, cropAPlusRegion, detectAPlusCrops } from "./aPlusCrop.js";

async function decodeImage(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
}

function analyzeSource(image, source) {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { width, height } = source;
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const plans = detectAPlusCrops(frame, width, height);
    return { ...source, preview: canvas.toDataURL("image/png"), plans };
}

async function encodeCrop(source, rect, mode) {
    const target = A_PLUS[mode];
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    if (source.docId != null) {
        const { url, offsetX, offsetY } = await invoke("ps.aPlus.readTile", {
            ...rect, mode, docId: source.docId, x: source.left + rect.x, y: source.top + rect.y,
        });
        const image = await decodeImage(url);
        const scale = rect.width / target.width;
        ctx.drawImage(image, offsetX / scale, offsetY / scale, image.naturalWidth / scale, image.naturalHeight / scale);
    } else {
        ctx.drawImage(source.image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("JPG 编码失败"));
    }, "image/jpeg", .92));
}

function download(blob, name) {
    const element = document.createElement("a");
    const url = URL.createObjectURL(blob);
    element.href = url;
    element.download = name;
    element.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function APlusCrop({ connected }) {
    const [mode, setMode] = useState("pc");
    const [source, setSource] = useState(null);
    const [manual, setManual] = useState({});
    const [draft, setDraft] = useState({ x: 0, y: 0 });
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const target = A_PLUS[mode];
    const crops = manual[mode] ?? source?.plans[mode] ?? [];

    async function loadSource(file) {
        setBusy(true);
        setStatus(null);
        let fileUrl;
        let session;
        try {
            let input;
            let url;
            if (file) {
                fileUrl = URL.createObjectURL(file);
                url = fileUrl;
            } else {
                const capture = await captureAll("canvas", {
                    longEdgeMax: 1800, previewEncodeMax: 1800, uploadEncodeFormat: "png", __retainUploadSession: true,
                });
                session = capture.uploadSessionId;
                const { left, top, right, bottom } = capture.bounds || {};
                if (capture.docId == null || ![left, top, right, bottom].every(Number.isInteger)) {
                    throw new Error("Photoshop 没有返回有效的画面范围。");
                }
                input = { name: "Photoshop", docId: capture.docId, left, top, width: right - left, height: bottom - top };
                url = capture.previewBase64;
            }
            const image = await decodeImage(url);
            setSource(analyzeSource(image, input || {
                name: file.name.replace(/\.[^.]+$/, ""), image, width: image.naturalWidth, height: image.naturalHeight,
            }));
            setManual({});
            setDraft({ x: 0, y: 0 });
        } catch (error) {
            setStatus({ error: true, text: error.message || "读取图片失败" });
        } finally {
            if (fileUrl) URL.revokeObjectURL(fileUrl);
            if (session) await wfArtAssistantReleaseUploadSession(session).catch(error => console.warn("释放 A+ 预览会话失败", error));
            setBusy(false);
        }
    }

    function setCrops(next) {
        setManual({ ...manual, [mode]: next.sort((a, b) => a.y - b.y || a.x - b.x) });
        setStatus(null);
    }

    function addCrop() {
        const { x, y } = draft;
        const rect = cropAPlusRegion({ x, y, width: target.width, height: target.height }, target)[0];
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
            x + rect.width > source.width || y + rect.height > source.height) {
            setStatus({ error: true, text: "裁切框超出图片。请调整左上角坐标。" });
            return;
        }
        if (crops.some(crop => crop.x === x && crop.y === y && crop.width === rect.width && crop.height === rect.height)) return;
        setCrops([...crops, rect]);
    }

    async function saveCrops() {
        setBusy(true);
        setStatus(null);
        let saved = 0;
        try {
            let folder;
            let existing;
            if (connected) {
                const root = await storage.localFileSystem.getFolder();
                if (!root) return;
                const entry = (await root.getEntries()).find(item => item.name.toLowerCase() === mode);
                if (entry?.isFile) throw new Error(`保存位置已有名为 ${mode} 的文件，请选择其他文件夹。`);
                folder = entry ? await root.getEntry(entry.name) : await root.createFolder(mode);
                existing = new Set((await folder.getEntries()).map(item => item.name.toLowerCase()));
            }
            const base = source.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 96) || "A+";
            const files = [];
            for (const [index, rect] of crops.entries()) {
                const stem = `${base}_${target.suffix}_${String(index + 1).padStart(2, "0")}`;
                let name = `${stem}.jpg`;
                for (let suffix = 2; existing?.has(name.toLowerCase()); suffix++) name = `${stem} (${suffix}).jpg`;
                const blob = await encodeCrop(source, rect, mode);
                if (folder) {
                    const file = await folder.createFile(name);
                    await file.write(await blob.arrayBuffer(), { format: storage.formats.binary, overwrite: false });
                    existing.add(name.toLowerCase());
                    saved++;
                } else files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
            }
            if (!folder) {
                if (files.length === 1) download(new Blob([files[0].bytes], { type: "image/jpeg" }), files[0].name);
                else download(new Blob([createCreativeZip(files)], { type: "application/zip" }), `${base}_${target.suffix}.zip`);
                saved = files.length;
            }
            setStatus({ text: folder ? `已保存 ${saved} 张 JPG 到 ${folder.nativePath || folder.name}。` : `已开始下载 ${saved} 张 JPG。` });
        } catch (error) {
            setStatus({ error: true, text: `${saved ? `已保存 ${saved} 张，其余未保存。 ` : ""}${error.message || "保存失败"}` });
        } finally { setBusy(false); }
    }

    return <section className="wfa-ps-tools-card wfa-aplus" aria-labelledby="wfa-aplus-title">
        <div className="wfa-ps-tools-heading">
            <h3 id="wfa-aplus-title">A+ 裁图</h3>
            <p>自动拆分长图，预览裁切框后保存 JPG。</p>
        </div>
        <fieldset disabled={busy}>
            <div className="wfa-aplus-row" role="group" aria-label="输出规格">
                {Object.entries(A_PLUS).map(([key, spec]) => <button type="button" key={key}
                    aria-pressed={mode === key} onClick={() => { setMode(key); setDraft({ x: 0, y: 0 }); setStatus(null); }}>
                    {spec.title}<small>{spec.width} × {spec.height}</small>
                </button>)}
            </div>
            <div className="wfa-aplus-row">
                <label className="wfa-aplus-import">导入图片
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) loadSource(file);
                    }} />
                </label>
                {connected && <button type="button" onClick={() => loadSource()}>读取 Photoshop</button>}
            </div>
            {source && <>
                <p>{source.width} × {source.height} px · {crops.length} 张{source.docId != null && " · 当前选区或画布"}</p>
                <div className="wfa-aplus-scroll">
                    <div className="wfa-aplus-preview">
                        <img src={source.preview} alt="带裁切框的原图预览" />
                        {crops.map((rect, index) => <span key={`${rect.x}:${rect.y}:${rect.width}`}
                            className="wfa-aplus-box" style={{ left: `${rect.x / source.width * 100}%`, top: `${rect.y / source.height * 100}%`,
                                width: `${rect.width / source.width * 100}%`, height: `${rect.height / source.height * 100}%` }}>
                            <button type="button" aria-label={`移除裁切框 ${index + 1}`} title="移除裁切框"
                                onClick={() => setCrops(crops.filter(crop => crop !== rect))}>{index + 1} ×</button>
                        </span>)}
                    </div>
                </div>
                {!crops.length && <p>未找到此规格的裁切框。可切换规格或手动添加。</p>}
                <details>
                    <summary>手动裁切</summary>
                    <div className="wfa-aplus-row">
                        {["x", "y"].map(axis => <label key={axis}>左上角 {axis.toUpperCase()}（px）
                            <input type="number" min="0" max={axis === "x" ? source.width - target.width : source.height - target.height}
                                value={draft[axis]} onChange={event => setDraft({ ...draft, [axis]: event.target.valueAsNumber || 0 })} />
                        </label>)}
                    </div>
                    <div className="wfa-aplus-row">
                        <button type="button" onClick={addCrop} disabled={source.width < target.width || source.height < target.height}>添加裁切框</button>
                        <button type="button" onClick={() => setCrops([...source.plans[mode]])}>恢复自动裁切</button>
                    </div>
                </details>
                <button type="button" className="wfa-aplus-save" disabled={!crops.length} onClick={saveCrops}>
                    {connected ? "保存" : "下载"} {crops.length} 张 JPG
                </button>
            </>}
        </fieldset>
        {busy && <p className="wfa-ps-tools-status" role="status">处理中…</p>}
        {status && <p className="wfa-ps-tools-status" role={status.error ? "alert" : "status"} data-error={status.error}>{status.text}</p>}
    </section>;
}

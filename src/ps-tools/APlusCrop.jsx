import React, { useState } from "react";
import { invoke } from "../bridge/uxpBridge.js";
import { storage } from "../bridge/uxpShim.js";
import { A_PLUS, cropAPlusRegion, detectAPlusCrops } from "./aPlusCrop.js";

async function decodeImage(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
}

async function paintPixels(ctx, pixels, scaleX, scaleY = scaleX) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!pixels.url) return;
    const image = await decodeImage(pixels.url);
    ctx.drawImage(image, pixels.offsetX * scaleX, pixels.offsetY * scaleY,
        pixels.pixelWidth * scaleX, pixels.pixelHeight * scaleY);
}

async function analyzeSource({ pixels, ...source }) {
    const canvas = document.createElement("canvas");
    const { width, height } = source;
    const scale = Math.min(1, 1800 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    await paintPixels(ctx, pixels, canvas.width / width, canvas.height / height);
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
    ctx.imageSmoothingQuality = "high";
    const pixels = await invoke("ps.aPlus.readTile", {
        ...rect, mode, docId: source.docId, layerId: source.layerId,
        x: source.left + rect.x, y: source.top + rect.y,
    });
    await paintPixels(ctx, pixels, target.width / rect.width);
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("JPG 编码失败"));
    }, "image/jpeg", .92));
}

export function APlusCrop({ connected }) {
    const [mode, setMode] = useState(null);
    const [source, setSource] = useState(null);
    const [manual, setManual] = useState({});
    const [draft, setDraft] = useState({ x: 0, y: 0 });
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const target = A_PLUS[mode];
    const crops = manual[mode] ?? source?.plans[mode] ?? [];

    async function loadSource() {
        setBusy(true);
        setStatus(null);
        setSource(null);
        setMode(null);
        try {
            const { bounds, docId, layerId, layerName, name, ...pixels } = await invoke("ps.aPlus.readStamp");
            const { left, top, right, bottom } = bounds || {};
            if (!pixels.url || ![docId, layerId, left, top, right, bottom].every(Number.isInteger) || right <= left || bottom <= top) {
                throw new Error("Photoshop 没有返回有效的盖印图层。");
            }
            setSource(await analyzeSource({ name: name.replace(/\.(psd|psb|tiff?)$/i, ""), layerName, docId,
                layerId, left, top, width: right - left, height: bottom - top, pixels }));
            setManual({});
            setDraft({ x: 0, y: 0 });
        } catch (error) {
            setStatus({ error: true, text: error.message || "读取盖印图层失败" });
        } finally {
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
            const folder = await storage.localFileSystem.getFolder();
            if (!folder) return;
            const existing = new Set((await folder.getEntries()).map(item => item.name.toLowerCase()));
            const base = source.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 96) || "A+";
            for (const [index, rect] of crops.entries()) {
                const stem = `${base}_${target.suffix}_${String(index + 1).padStart(2, "0")}`;
                let name = `${stem}.jpg`;
                for (let suffix = 2; existing.has(name.toLowerCase()); suffix++) name = `${stem} (${suffix}).jpg`;
                const blob = await encodeCrop(source, rect, mode);
                const file = await folder.createFile(name);
                await file.write(await blob.arrayBuffer(), { format: storage.formats.binary, overwrite: false });
                existing.add(name.toLowerCase());
                saved++;
            }
            setStatus({ text: `已保存 ${saved} 张 JPG 到 ${folder.nativePath || folder.name}。` });
        } catch (error) {
            setStatus({ error: true, text: `${saved ? `已保存 ${saved} 张，其余未保存。 ` : ""}${error.message || "保存失败"}` });
        } finally { setBusy(false); }
    }

    return <section className="wfa-ps-tools-card wfa-aplus" aria-labelledby="wfa-aplus-title">
        <div className="wfa-ps-tools-heading">
            <h3 id="wfa-aplus-title">A+ 裁图</h3>
            <p>{connected ? "在 Photoshop 中选中最终盖印图层，读取后选择 PC 或 SJ。" : "请在 Photoshop 中打开 WF美工助手，读取最终盖印图层。"}</p>
        </div>
        <fieldset disabled={busy}>
            <button type="button" disabled={!connected} onClick={loadSource}>{source ? "重新读取盖印图层" : "读取 Photoshop 盖印图层"}</button>
            {source && <p>{source.layerName} · {source.width} × {source.height} px</p>}
            {source && <div className="wfa-aplus-row" role="group" aria-label="输出规格">
                {Object.entries(A_PLUS).map(([key, spec]) => <button type="button" key={key}
                    aria-pressed={mode === key} onClick={() => { setMode(key); setDraft({ x: 0, y: 0 }); setStatus(null); }}>
                    {spec.title}<small>{spec.width} × {spec.height}</small>
                </button>)}
            </div>}
            {source && target && <>
                <p>{crops.length} 张</p>
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
                    选择位置并保存 {crops.length} 张 JPG
                </button>
            </>}
        </fieldset>
        {busy && <p className="wfa-ps-tools-status" role="status">处理中…</p>}
        {status && <p className="wfa-ps-tools-status" role={status.error ? "alert" : "status"} data-error={status.error}>{status.text}</p>}
    </section>;
}

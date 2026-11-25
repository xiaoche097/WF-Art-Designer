import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "../bridge/uxpBridge.js";
import { buildToneBands, combineToneBands, renderTone } from "../../plugin/host/retouch/clothTone.js";
import { findClothes } from "./clothMask.js";
import { ClothSliders, DEFAULT_CLOTH_SETTINGS, getClothParts } from "./ClothSliders.jsx";
import { ClothFinishing } from "./ClothFinishing.jsx";

const decode = value => Uint8ClampedArray.from(atob(value), char => char.charCodeAt(0));

function encode(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(chunks.join(""));
}

function Preview({ frame, pixels, overlay, interactive, handlers }) {
    const canvas = useRef(null);
    useEffect(() => {
        const context = canvas.current.getContext("2d");
        const image = context.createImageData(frame.width, frame.height);
        image.data.set(pixels);
        if (overlay) {
            for (let p = 0; p < overlay.length; p++) {
                const i = p * 4;
                const weight = overlay[p] / 680;
                image.data[i] += (70 - image.data[i]) * weight;
                image.data[i + 1] += (160 - image.data[i + 1]) * weight;
                image.data[i + 2] += (255 - image.data[i + 2]) * weight;
            }
        }
        context.putImageData(image, 0, 0);
    }, [frame, pixels, overlay]);
    return <canvas ref={canvas} width={frame.width} height={frame.height}
        className={interactive ? "wfa-cloth-preview" : undefined}
        aria-label="衣物美化预览" {...(interactive ? handlers : {})} />;
}

function brushAt(mask, source, point, radius, add) {
    const { width, height, pixels } = source.frame;
    for (let y = Math.max(0, point.y - radius); y <= Math.min(height - 1, point.y + radius); y++) {
        for (let x = Math.max(0, point.x - radius); x <= Math.min(width - 1, point.x + radius); x++) {
            const strength = Math.min(1, 2 * (1 - Math.hypot(x - point.x, y - point.y) / radius));
            const i = y * width + x;
            if (strength <= 0 || pixels[4 * i + 3] !== 255) continue;
            mask[i] = add ? Math.max(mask[i], source.approvedClothing[i] * strength) : mask[i] * (1 - strength);
        }
    }
}

export function ClothTool({ connected }) {
    const [document, setDocument] = useState(null);
    const [source, setSource] = useState(null);
    const [edit, setEdit] = useState(null);
    const [settings, setSettings] = useState(DEFAULT_CLOTH_SETTINGS);
    const [layerId, setLayerId] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showMask, setShowMask] = useState(false);
    const [applied, setApplied] = useState(false);
    const [brush, setBrush] = useState(null);
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [draft, setDraft] = useState(null);
    const stroke = useRef(null);
    const pending = useRef(false);

    const mask = draft || edit?.mask;
    const parts = useMemo(() => getClothParts(edit?.mask, edit?.regions), [edit]);
    const bands = useMemo(() => source && edit
        ? buildToneBands(source.frame.pixels, edit.mask, source.frame.width, source.frame.height)
        : null, [source, edit]);
    const pixels = useMemo(() => {
        if (!source) return null;
        const { pixels, width, height } = source.frame;
        return !bands || (!settings.fine && !settings.coarse) || showOriginal ? pixels
            : renderTone(pixels, width, height, combineToneBands(bands, settings, edit.regions), width, height, mask, 100);
    }, [source, bands, edit, mask, settings, showOriginal]);

    function notify(text, error = false) {
        setNotice(text ? { text, error } : null);
    }

    async function run(message, task) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        notify(message);
        try { await task(); }
        catch (error) { notify(error.message || String(error), true); }
        finally { setBusy(false); pending.current = false; }
    }

    function resetEdits() {
        setEdit(null);
        setPast([]);
        setFuture([]);
        setDraft(null);
        setBrush(null);
        setShowOriginal(false);
        setShowMask(false);
        setApplied(false);
        stroke.current = null;
    }

    async function readPhoto(scanned, selectedLayer = null) {
        setSource(null);
        resetEdits();
        let target = scanned;
        if (!target.format.ready) {
            if (!target.format.canConvert) throw Error("请在 Photoshop 中将文档副本转换为 8 位 RGB 和 sRGB 后重试。");
            notify("正在准备 Photoshop 工作副本…");
            target = await invoke("cloth.prepareCopy", { docId: target.docId });
        }
        setDocument(target);
        setLayerId(selectedLayer == null ? "" : String(selectedLayer));
        const result = await invoke("cloth.read", { docId: target.docId, layerId: selectedLayer });
        const next = {
            ...result,
            frame: { width: result.previewWidth, height: result.previewHeight, pixels: decode(result.rgba) },
            limit: decode(result.constraint),
        };
        setSource(next);
        notify("正在识别衣物…");
        try {
            const detected = await findClothes(next.frame, next.limit);
            if (!detected) {
                notify("没有可靠的衣物范围。请调整 Photoshop 选区或换图后重新读取。", true);
                return;
            }
            const approved = await invoke("cloth.registerScope", {
                id: next.id, mask: encode(detected.mask), regions: encode(detected.regions),
            });
            const approvedClothing = decode(approved.clothing);
            const approvedShoes = decode(approved.shoes);
            setSource({ ...next, approvedClothing, approvedShoes, regions: detected.regions });
            if (approvedClothing.some(Boolean)) setEdit({ mask: approvedClothing, regions: detected.regions });
            else notify("未识别到可安全修饰的衣物范围。", true);
            if (approvedClothing.some(Boolean)) notify(null);
        } catch (error) {
            console.warn("[WF] Clothing recognition failed", error);
            notify("衣物识别失败。请重新读取后再生成图层。", true);
        }
    }

    function chooseImage() {
        run("打开图片…", async () => {
            const opened = await invoke("cloth.openImage");
            if (!opened) { notify(null); return; }
            await readPhoto(opened);
        });
    }

    function readCurrent() {
        run("正在读取 Photoshop 文档…", async () => readPhoto(await invoke("cloth.inspect")));
    }

    function changeMask(next) {
        setPast(items => [...items.slice(-7), edit]);
        setFuture([]);
        setEdit(next);
    }

    function undo() {
        setFuture(items => [edit, ...items]);
        setEdit(past[past.length - 1]);
        setPast(past.slice(0, -1));
    }

    function redo() {
        setPast(items => [...items, edit]);
        setEdit(future[0]);
        setFuture(future.slice(1));
    }

    function pointFromEvent(event) {
        const box = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.min(source.frame.width - 1, Math.max(0, Math.floor((event.clientX - box.left) * source.frame.width / box.width))),
            y: Math.min(source.frame.height - 1, Math.max(0, Math.floor((event.clientY - box.top) * source.frame.height / box.height))),
        };
    }

    function paint(event) {
        const point = pointFromEvent(event);
        const current = stroke.current;
        const steps = Math.max(1, Math.ceil(Math.hypot(point.x - current.last.x, point.y - current.last.y) / 6));
        for (let s = 1; s <= steps; s++) {
            brushAt(current.mask, source, {
                x: Math.round(current.last.x + (point.x - current.last.x) * s / steps),
                y: Math.round(current.last.y + (point.y - current.last.y) * s / steps),
            }, 18, brush === "add");
        }
        current.last = point;
        setDraft(new Uint8ClampedArray(current.mask));
    }

    const handlers = {
        onPointerDown: event => {
            if (event.button !== 0 || busy || applied || !source.approvedClothing) return;
            stroke.current = {
                last: pointFromEvent(event),
                mask: new Uint8ClampedArray(edit?.mask ?? source.limit.length),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            paint(event);
        },
        onPointerMove: event => { if (stroke.current) paint(event); },
        onPointerUp: () => {
            if (stroke.current) changeMask({ mask: stroke.current.mask, regions: source.regions });
            stroke.current = null;
            setDraft(null);
        },
        onPointerCancel: () => { stroke.current = null; setDraft(null); },
    };

    function getRequest() {
        return { id: source.id, mask: encode(edit.mask), scope: "clothing",
            regions: encode(source.regions), settings };
    }

    async function writeLayer(request) {
        await invoke("cloth.apply", request);
        setApplied(true);
        setBrush(null);
        notify("已应用到新的 Photoshop 图层。");
    }

    function openPreview() {
        run("正在打开大图预览…", async () => {
            const request = getRequest();
            const confirmed = await invoke("cloth.previewDialog", request);
            if (!confirmed) { notify(null); return; }
            setSettings(confirmed);
            notify("正在写入衣物美化图层…");
            await writeLayer({ ...request, settings: confirmed });
        });
    }

    const blocked = !edit || busy || applied || Boolean(draft);
    const canWrite = (settings.fine || settings.coarse) &&
        ((parts.upper || parts.dress) && settings.upper || parts.lower && settings.lower);

    return <section className="wfa-retouch-card wfa-cloth-tool" aria-busy={busy}>
        <div className="wfa-retouch-heading">
            <h2>衣物美化</h2>
            {source && <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
                {showOriginal ? "看效果" : "看原图"}
            </button>}
        </div>
        <div className="wfa-retouch-actions">
            <button type="button" disabled={!connected || busy} onClick={chooseImage}>导入图片</button>
            <button type="button" disabled={!connected || busy} onClick={readCurrent}>读取当前文档</button>
        </div>
        {source && <>
            <ClothSliders settings={settings} parts={parts} disabled={!edit || busy || applied}
                onChange={(key, value) => {
                    setSettings(current => current[key] === value ? current : { ...current, [key]: value });
                    setShowOriginal(false);
                }} />
            <div className="wfa-retouch-actions">
                <button type="button" disabled={blocked} onClick={openPreview}>打开大图预览</button>
                <button type="button" className="wfa-retouch-primary" disabled={blocked || !canWrite}
                    onClick={() => run("正在写入衣物美化图层…", () => writeLayer(getRequest()))}>
                    {applied ? "已生成图层" : "生成图层到 Photoshop"}
                </button>
            </div>
            <div className="wfa-retouch-actions">
                {edit && <button type="button" aria-pressed={showMask} onClick={() => setShowMask(value => !value)}>
                    {showMask ? "隐藏衣物范围" : "查看衣物范围"}
                </button>}
            </div>
            <Preview frame={source.frame} pixels={pixels} overlay={(showMask || brush) && mask}
                interactive={Boolean(brush && !applied)} handlers={handlers} />
            {!!source.approvedClothing && <ClothFinishing key={source.id} source={source} mask={edit?.mask}
                disabled={busy || applied} onWrite={(candidate, area, scope) =>
                    run("正在写入局部修复图层…", () => writeLayer({
                        id: source.id, mask: encode(area), generated: encode(candidate), scope, settings,
                    }))} />}
            {!applied && <details className="wfa-cloth-advanced" onToggle={event => {
                if (!event.currentTarget.open) setBrush(null);
            }}>
                <summary>高级 · 蒙版</summary>
                <div className="wfa-retouch-actions">
                    {source.approvedClothing?.some(Boolean) && <button type="button" disabled={busy} onClick={() => {
                        changeMask({ mask: source.approvedClothing, regions: source.regions });
                        notify(null);
                    }}>恢复识别范围</button>}
                    {document?.masks.length > 0 && <label className="wfa-retouch-field">图层蒙版
                        <select value={layerId} disabled={busy} onChange={event => {
                            const id = event.target.value;
                            run("正在读取蒙版…", () => readPhoto(document, id ? Number(id) : null));
                        }}>
                            <option value="">自动识别</option>
                            {document.masks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </label>}
                </div>
                <div className="wfa-retouch-actions">
                    <button type="button" disabled={busy || !source.approvedClothing} aria-pressed={brush === "add"} onClick={() => setBrush(brush === "add" ? null : "add")}>恢复画笔</button>
                    <button type="button" disabled={busy || !edit} aria-pressed={brush === "erase"} onClick={() => setBrush(brush === "erase" ? null : "erase")}>擦除画笔</button>
                    <button type="button" disabled={busy || !past.length} onClick={undo}>撤销</button>
                    <button type="button" disabled={busy || !future.length} onClick={redo}>重做</button>
                </div>
            </details>}
        </>}
        {notice && <p className="wfa-retouch-notice" role="status" data-error={notice.error || undefined}>{notice.text}</p>}
    </section>;
}

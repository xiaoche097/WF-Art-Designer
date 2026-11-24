import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "../bridge/uxpBridge.js";
import { buildToneField, renderTone } from "../../plugin/host/retouch/clothTone.js";
import { findClothes } from "./clothMask.js";

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
            mask[i] = add ? Math.max(mask[i], source.limit[i] * strength) : mask[i] * (1 - strength);
        }
    }
}

export function ClothTool({ connected }) {
    const [document, setDocument] = useState(null);
    const [source, setSource] = useState(null);
    const [edit, setEdit] = useState(null);
    const [strength, setStrength] = useState(50);
    const [layerId, setLayerId] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [applied, setApplied] = useState(false);
    const [brush, setBrush] = useState(null);
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [draft, setDraft] = useState(null);
    const stroke = useRef(null);
    const pending = useRef(false);

    const mask = draft || edit?.mask;
    const field = useMemo(() => source && edit
        ? buildToneField(source.frame.pixels, edit.mask, source.frame.width, source.frame.height)
        : null, [source, edit]);
    const pixels = useMemo(() => {
        if (!source) return null;
        const { pixels, width, height } = source.frame;
        return !field || !strength || showOriginal ? pixels : renderTone(pixels, width, height, field, width, height, mask, strength);
    }, [source, field, mask, strength, showOriginal]);

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
        if (selectedLayer != null) {
            setEdit({ mask: next.limit, fromPhotoshop: true });
            notify(null);
            return;
        }
        notify("正在识别衣物…");
        try {
            const detected = await findClothes(next.frame, next.limit);
            if (!detected) {
                notify("没找到清晰的衣物区域，可在「高级」中添加蒙版。", true);
                return;
            }
            setEdit({ mask: detected, fromPhotoshop: false });
            notify(null);
        } catch (error) {
            console.warn("[WF] Clothing recognition failed", error);
            notify("衣物识别暂不可用，可在「高级」中使用 Photoshop 蒙版或画笔。", true);
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
            if (event.button !== 0 || busy || applied) return;
            stroke.current = {
                last: pointFromEvent(event),
                mask: new Uint8ClampedArray(edit?.mask ?? source.limit.length),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            paint(event);
        },
        onPointerMove: event => { if (stroke.current) paint(event); },
        onPointerUp: () => {
            if (stroke.current) changeMask({ mask: stroke.current.mask, fromPhotoshop: false });
            stroke.current = null;
            setDraft(null);
        },
        onPointerCancel: () => { stroke.current = null; setDraft(null); },
    };

    const canApply = Boolean(field?.some(value => Math.abs(value * strength / 100) >= .5));

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
            <label className="wfa-cloth-strength">
                <span>美化强度 <output>{strength}%</output></span>
                <input aria-label="美化强度" type="range" min="0" max="100" step="1" value={strength}
                    disabled={!edit || busy || applied} onChange={event => {
                        setStrength(Number(event.target.value));
                        setShowOriginal(false);
                    }} />
            </label>
            <Preview frame={source.frame} pixels={pixels} overlay={brush && mask} interactive={Boolean(brush && !applied)} handlers={handlers} />
            <button type="button" className="wfa-retouch-primary" disabled={!canApply || busy || applied || Boolean(draft)}
                onClick={() => run("正在写入衣物美化图层…", async () => {
                    await invoke("cloth.apply", {
                        id: source.id, mask: edit.fromPhotoshop ? null : encode(edit.mask),
                        fromPhotoshop: edit.fromPhotoshop, strength,
                    });
                    setApplied(true);
                    setBrush(null);
                    notify("已应用到新的 Photoshop 图层。");
                })}>{applied ? "已应用到图层" : "应用到图层"}</button>
            {!applied && <details className="wfa-cloth-advanced" onToggle={event => {
                if (!event.currentTarget.open) setBrush(null);
            }}>
                <summary>高级 · 蒙版</summary>
                <div className="wfa-retouch-actions">
                    {source.hasMask && <button type="button" disabled={busy} onClick={() => {
                        changeMask({ mask: source.limit, fromPhotoshop: true });
                        notify(null);
                    }}>使用 Photoshop 选区或蒙版</button>}
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
                    <button type="button" disabled={busy} aria-pressed={brush === "add"} onClick={() => setBrush(brush === "add" ? null : "add")}>添加画笔</button>
                    <button type="button" disabled={busy || !edit} aria-pressed={brush === "erase"} onClick={() => setBrush(brush === "erase" ? null : "erase")}>擦除画笔</button>
                    <button type="button" disabled={busy || !past.length} onClick={undo}>撤销</button>
                    <button type="button" disabled={busy || !future.length} onClick={redo}>重做</button>
                </div>
            </details>}
        </>}
        {notice && <p className="wfa-retouch-notice" role="status" data-error={notice.error || undefined}>{notice.text}</p>}
    </section>;
}

import React, { useEffect, useRef, useState } from "react";
import { invoke } from "../bridge/uxpBridge.js";

const decode = encoded => Uint8ClampedArray.from(atob(encoded), char => char.charCodeAt(0));
function encode(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    return btoa(chunks.join(""));
}

function PaintCanvas({ frame, mask, points = [], overlay, native, canvasProps }) {
    const ref = useRef(null);
    useEffect(() => {
        const context = ref.current.getContext("2d");
        const data = context.createImageData(frame.width, frame.height);
        data.data.set(frame.pixels);
        if (overlay && mask) {
            for (let p = 0; p < mask.length; p++) {
                const offset = p * 4;
                const weight = mask[p] / 510;
                data.data[offset] *= 1 - weight;
                data.data[offset + 1] += (216 - data.data[offset + 1]) * weight;
                data.data[offset + 2] += (186 - data.data[offset + 2]) * weight;
            }
        }
        context.putImageData(data, 0, 0);
        const radius = Math.max(3, Math.round(frame.width / 100));
        for (const point of points) {
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, Math.PI * 2);
            context.fillStyle = point.positive ? "#1fe3ad" : "#ff6a90";
            context.fill();
            context.strokeStyle = "#161c24";
            context.stroke();
        }
    }, [frame, mask, points, overlay]);
    return <canvas ref={ref} width={frame.width} height={frame.height} className={native ? "wfa-cloth-native" : "wfa-cloth-preview"}
        style={native ? { width: frame.width, height: frame.height } : undefined} {...canvasProps} />;
}

function brushAt(mask, source, point, radius, add) {
    const { width, height } = source.frame;
    for (let y = Math.max(0, point.y - radius); y <= Math.min(height - 1, point.y + radius); y++) {
        for (let x = Math.max(0, point.x - radius); x <= Math.min(width - 1, point.x + radius); x++) {
            const distance = Math.hypot(x - point.x, y - point.y);
            if (distance > radius) continue;
            const strength = Math.min(1, 2 * (1 - distance / radius));
            const i = y * width + x;
            if (add) mask[i] = Math.max(mask[i], Math.round(source.limit[i] * strength));
            else mask[i] = Math.min(mask[i], Math.round(source.limit[i] * (1 - strength)));
        }
    }
}

export function ClothTool({ connected }) {
    const [document, setDocument] = useState(null);
    const [layerId, setLayerId] = useState("");
    const [source, setSource] = useState(null);
    const [edit, setEdit] = useState({ points: [], mask: null, manual: false });
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [mode, setMode] = useState("positive");
    const [radius, setRadius] = useState(16);
    const [token, setToken] = useState("");
    const [overlay, setOverlay] = useState(true);
    const [detail, setDetail] = useState(null);
    const [draft, setDraft] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(false);
    const stroke = useRef(null);
    const lock = useRef(false);

    function notify(text, error = false) { setNotice({ text, error }); }

    async function run(message, task) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        notify(message);
        try { await task(); }
        catch (error) { notify(error.message || String(error), true); }
        finally { setBusy(false); lock.current = false; }
    }

    function reset() {
        setDetail(null);
        setSource(null);
        setEdit({ points: [], mask: null, manual: false });
        setPast([]);
        setFuture([]);
        setDraft(null);
        stroke.current = null;
    }

    function commit(next) {
        setPast(items => [...items.slice(-15), edit]);
        setFuture([]);
        setEdit(next);
    }

    function undo() {
        if (!past.length) return;
        setFuture(items => [edit, ...items]);
        setEdit(past[past.length - 1]);
        setPast(items => items.slice(0, -1));
    }

    function redo() {
        if (!future.length) return;
        setPast(items => [...items, edit]);
        setEdit(future[0]);
        setFuture(items => items.slice(1));
    }

    function readSource() {
        run("正在读取原图、选区和蒙版…", async () => {
            reset();
            const result = await invoke("cloth.read", { docId: document.docId, layerId: layerId ? Number(layerId) : null });
            setSource({
                ...result,
                frame: { width: result.previewWidth, height: result.previewHeight, pixels: decode(result.rgba) },
                limit: decode(result.constraint),
            });
            notify("原图已读取。添加正负点，或直接使用 Photoshop 蒙版。");
        });
    }

    function pointFromEvent(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(source.frame.width - 1, Math.floor((event.clientX - rect.left) * source.frame.width / rect.width))),
            y: Math.max(0, Math.min(source.frame.height - 1, Math.floor((event.clientY - rect.top) * source.frame.height / rect.height))),
        };
    }

    function segment(points) {
        run("正在本机运行 SAM 2.1 Tiny…", async () => {
            const result = await invoke("cloth.segment", { id: source.id, points, token: token.trim() });
            commit({ points, mask: decode(result.mask), manual: false });
            notify("分割完成。请检查衣领、手臂、头发和下摆边界。");
        });
    }

    function onPointerDown(event) {
        if (busy || event.button !== 0) return;
        const point = pointFromEvent(event);
        if (mode === "detail") {
            run("正在读取原始像素…", async () => {
                const x = Math.floor((point.x + .5) * source.width / source.frame.width);
                const y = Math.floor((point.y + .5) * source.height / source.frame.height);
                const tile = await invoke("cloth.detail", { id: source.id, x, y });
                setDetail({ ...tile, pixels: decode(tile.rgba), limit: decode(tile.constraint) });
                notify("已打开 100% 检查视图，可滚动查看。");
            });
        } else if (mode === "positive" || mode === "negative") {
            if (edit.points.length >= 64) { notify("最多 64 个提示点。", true); return; }
            if (mode === "positive" && !source.limit[point.y * source.frame.width + point.x]) {
                notify("正点必须位于 Photoshop 允许的范围内。", true);
                return;
            }
            commit({ ...edit, points: [...edit.points, { ...point, positive: mode === "positive" }], mask: null, manual: false });
        } else {
            if (!edit.mask) { notify("请先分割衣物或导入 Photoshop 蒙版。", true); return; }
            const mask = new Uint8ClampedArray(edit.mask);
            brushAt(mask, source, point, radius, mode === "add");
            stroke.current = { point, mask };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraft(new Uint8ClampedArray(mask));
        }
    }

    function onPointerMove(event) {
        if (!stroke.current) return;
        const { point: last, mask } = stroke.current;
        const point = pointFromEvent(event);
        const steps = Math.max(1, Math.ceil(Math.hypot(point.x - last.x, point.y - last.y) / Math.max(1, radius / 3)));
        for (let s = 1; s <= steps; s++) {
            brushAt(mask, source, { x: Math.round(last.x + (point.x - last.x) * s / steps),
                y: Math.round(last.y + (point.y - last.y) * s / steps) }, radius, mode === "add");
        }
        stroke.current.point = point;
        setDraft(new Uint8ClampedArray(mask));
    }

    const shownMask = draft || edit.mask;
    let detailMask;
    if (detail && shownMask) {
        detailMask = new Uint8ClampedArray(detail.limit);
        for (let y = 0; y < detail.height && !edit.manual; y++) {
            const row = Math.floor((detail.top + y + .5) * source.frame.height / source.height) * source.frame.width;
            for (let x = 0; x < detail.width; x++) {
                const i = y * detail.width + x;
                detailMask[i] = Math.min(detailMask[i], shownMask[row + Math.floor((detail.left + x + .5) * source.frame.width / source.width)]);
            }
        }
    }

    return <>
        <section className="wfa-retouch-card">
            <h2>衣物美化</h2>
            <p className="wfa-retouch-hint">本阶段支持衣物分割、蒙版编辑和独立图层，去褶处理尚未开放。</p>
            <button type="button" disabled={!connected || busy} onClick={() => run("正在扫描 Photoshop…", async () => {
                reset(); setDocument(null); setLayerId("");
                setDocument(await invoke("cloth.inspect"));
                notify("请选择像素蒙版，或直接读取当前画面和选区。");
            })}>扫描 Photoshop</button>
            {document && <>
                <p>{document.title} · {document.hasSelection ? "已选区域" : "当前画面"}</p>
                <label className="wfa-retouch-field">Photoshop 蒙版
                    <select value={layerId} disabled={busy} onChange={event => { setLayerId(event.target.value); reset(); }}>
                        <option value="">不指定图层蒙版</option>
                        {document.masks.map(mask => <option key={mask.id} value={mask.id}>{mask.name}</option>)}
                    </select>
                </label>
                <button type="button" disabled={busy} onClick={readSource}>读取像素</button>
            </>}
        </section>
        {source && <section className="wfa-retouch-card">
            <p>{source.width} × {source.height} · 8 位 sRGB</p>
            <label className="wfa-retouch-field">本地 SAM 配对码
                <input type="password" value={token} autoComplete="off" disabled={busy} onChange={event => setToken(event.target.value)} />
            </label>
            <div className="wfa-retouch-actions">
                <button type="button" disabled={busy || !token.trim() || !edit.points.some(point => point.positive)} onClick={() => segment(edit.points)}>运行 SAM 分割</button>
                <button type="button" disabled={busy || !source.hasMask} onClick={() => {
                    commit({ points: [], mask: source.limit, manual: true });
                    notify("已使用 Photoshop 选区或像素蒙版。");
                }}>使用 Photoshop 蒙版</button>
            </div>
            <div className="wfa-retouch-actions" aria-label="蒙版工具">
                {[["positive", "正点"], ["negative", "负点"], ["add", "添加画笔"], ["erase", "擦除画笔"], ["detail", "100% 检查"]].map(([key, label]) =>
                    <button type="button" key={key} aria-pressed={mode === key}
                        disabled={busy || ((key === "add" || key === "erase") && !edit.mask)} onClick={() => setMode(key)}>{label}</button>)}
                <button type="button" disabled={busy || !past.length} onClick={undo}>撤销</button>
                <button type="button" disabled={busy || !future.length} onClick={redo}>重做</button>
            </div>
            {(mode === "add" || mode === "erase") && <label className="wfa-retouch-field">画笔大小 {radius}
                <input type="range" min="2" max="80" value={radius} disabled={busy} onChange={event => setRadius(Number(event.target.value))} />
            </label>}
            <label><input type="checkbox" checked={overlay} onChange={event => setOverlay(event.target.checked)} />显示蒙版叠色</label>
            <PaintCanvas frame={source.frame} mask={shownMask} overlay={overlay} points={edit.points} canvasProps={{
                "aria-label": "衣物原图与蒙版预览", onPointerDown, onPointerMove,
                onPointerUp: () => {
                    if (!stroke.current) return;
                    commit({ ...edit, mask: stroke.current.mask, manual: false });
                    stroke.current = null; setDraft(null);
                },
                onPointerCancel: () => { stroke.current = null; setDraft(null); },
            }} />
            {detail && <>
                <button type="button" onClick={() => setDetail(null)}>关闭 100% 检查</button>
                <div className="wfa-cloth-detail"><PaintCanvas frame={detail} mask={detailMask} overlay={overlay} native
                    canvasProps={{ "aria-label": "原始像素 100% 检查" }} /></div>
            </>}
            <button type="button" className="wfa-retouch-primary" disabled={busy || !edit.mask} onClick={() => run("正在写入独立图层和蒙版…", async () => {
                await invoke("cloth.apply", { id: source.id, mask: edit.manual ? null : encode(edit.mask), fromPhotoshop: edit.manual });
                reset();
                notify("已创建默认隐藏的分割副本及独立蒙版。可在 Photoshop 图层面板查看，或撤销本次写入。");
            })}>写入独立图层</button>
        </section>}
        {notice && <p className="wfa-retouch-notice" role="status" data-error={notice.error || undefined}>{notice.text}</p>}
    </>;
}

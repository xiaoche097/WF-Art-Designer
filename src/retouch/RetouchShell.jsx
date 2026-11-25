import React, { useEffect, useRef, useState } from "react";
import { invoke, isInWebView } from "../bridge/uxpBridge.js";
import { WorkspaceHeader } from "../components/WorkspaceHeader.jsx";
import { ClothTool } from "./ClothTool.jsx";
import recolor from "./recolorCore.js";
import { overlayPreview, readRecolorSample, referenceFromFile } from "./recolorImages.js";
import "./RetouchShell.css";

const MODES = [
    ["mode1", "柔和曲线"],
    ["mode2", "可选颜色"],
    ["mode3", "渐变映射"],
    ["mode4", "通道混合"],
];
const LIMIT = 40;

function CanvasImage({ image, label, canvasProps }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        if (!image) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const pixels = ctx.createImageData(image.width, image.height);
        pixels.data.set(image.data);
        ctx.putImageData(pixels, 0, 0);
    }, [image]);
    return <canvas ref={canvasRef} width={image.width} height={image.height} role="img" aria-label={label} {...canvasProps} />;
}

function rectangle(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function ReferencePreview({ reference, onRegion, disabled }) {
    const start = useRef(null);
    const [draft, setDraft] = useState(null);
    const { image } = reference;
    const region = draft || reference.region;
    function point(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(image.width, Math.round((event.clientX - rect.left) * image.width / rect.width))),
            y: Math.max(0, Math.min(image.height, Math.round((event.clientY - rect.top) * image.height / rect.height))),
        };
    }
    return (
        <div className="wfa-retouch-reference">
            <CanvasImage image={image} label="参考图，拖动框选服装取色" canvasProps={{
                onPointerDown: event => {
                    if (disabled || event.button !== 0) return;
                    start.current = point(event);
                    event.currentTarget.setPointerCapture(event.pointerId);
                },
                onPointerMove: event => {
                    if (start.current) setDraft(rectangle(start.current, point(event)));
                },
                onPointerUp: event => {
                    if (!start.current) return;
                    const area = rectangle(start.current, point(event));
                    start.current = null;
                    setDraft(null);
                    if (area.width >= 3 && area.height >= 3) onRegion(area);
                },
                onPointerCancel: () => { start.current = null; setDraft(null); },
            }} />
            {region && <span aria-hidden="true" className="wfa-retouch-region" style={{
                left: `${region.x / image.width * 100}%`, top: `${region.y / image.height * 100}%`,
                width: `${region.width / image.width * 100}%`, height: `${region.height / image.height * 100}%`,
            }} />}
        </div>
    );
}

function BatchRecolor({ connected }) {
    const [document, setDocument] = useState(null);
    const [groupId, setGroupId] = useState("");
    const [source, setSource] = useState(null);
    const [references, setReferences] = useState([]);
    const [selected, setSelected] = useState(null);
    const [preview, setPreview] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const nextId = useRef(0);
    const current = references.find(ref => ref.id === selected);
    const currentStats = current?.stats;
    const currentMode = current?.mode;
    const currentStrength = current?.strength;
    const comparison = preview?.source === source && preview?.stats === currentStats &&
        preview?.mode === currentMode && preview?.strength === currentStrength ? preview : null;
    const ready = references.filter(ref => ref.enabled && ref.stats && ref.name.trim());

    useEffect(() => {
        if (!source || !currentStats) {
            setPreview(null);
            return;
        }
        const timer = setTimeout(() => {
            const identity = { source, stats: currentStats, mode: currentMode, strength: currentStrength };
            try {
                const { transform } = recolor.buildPipelineMode({ src: source.stats, ref: currentStats }, {
                    matchMode: currentMode, colorStrength: currentStrength / 100,
                });
                setPreview({ ...identity, image: overlayPreview(source.image,
                    recolor.renderToImageData(source.image, source.weight, transform)) });
            } catch (error) {
                setPreview({ ...identity, error: error.message || String(error) });
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [source, currentStats, currentMode, currentStrength]);

    function notify(text, error = false) { setNotice({ text, error }); }

    async function run(label, work) {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        notify(label);
        try {
            await work();
        } catch (error) {
            notify(error.message || String(error), true);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    function clearSource() {
        setSource(null);
        setPreview(null);
        setReferences(items => items.map(ref => ({ ...ref, stats: null, message: "" })));
    }

    function updateReference(id, changes) {
        setReferences(items => items.map(ref => ref.id === id ? { ...ref, ...changes } : ref));
    }

    function scanDocument() {
        run("正在扫描 Photoshop 文档…", async () => {
            clearSource();
            setDocument(null);
            setGroupId("");
            const doc = await invoke("retouch.inspect");
            const group = doc.groups.find(entry => entry.enabled);
            setDocument(doc);
            setGroupId(group ? String(group.id) : "");
            notify(group ? "选择服装蒙版组后读取原图。" : "请在 Photoshop 中创建带启用像素蒙版的服装图层组。", !group);
        });
    }

    function readSource() {
        run("正在读取合成图和蒙版…", async () => {
            clearSource();
            const target = { docId: document.docId, layerId: Number(groupId) };
            const { image, weight } = readRecolorSample(await invoke("retouch.read", target));
            setSource({ target, image, weight, stats: recolor.analyzeSource(image, weight) });
            notify("已读取原图，可以分析参考图。");
        });
    }

    function importReferences(event) {
        const files = Array.from(event.target.files);
        event.target.value = "";
        run("正在读取参考图…", async () => {
            const added = [];
            const errors = [];
            const available = LIMIT - references.length;
            for (const file of files.slice(0, available)) {
                try {
                    const image = await referenceFromFile(file);
                    added.push({
                        id: ++nextId.current, image, name: (file.name.replace(/\.[^.]+$/, "").trim() || "新 SKU").slice(0, 160),
                        enabled: true, mode: "mode1", strength: 100, region: null,
                    });
                } catch (error) { errors.push(`${file.name}：${error.message}`); }
            }
            setReferences(items => [...items, ...added]);
            if (!selected && added.length) setSelected(added[0].id);
            if (files.length > available) errors.push("每批最多 40 张参考图");
            notify(`已加入 ${added.length} 张参考图。${errors.join(" · ")}`, errors.length > 0);
        });
    }

    function analyze() {
        run("正在分析参考图…", async () => {
            let count = 0;
            const analyzed = [];
            for (const ref of references) {
                if (!ref.enabled || ref.stats) {
                    analyzed.push(ref);
                    continue;
                }
                notify(`正在分析 ${ref.name}…`);
                await new Promise(resolve => setTimeout(resolve, 0));
                try {
                    const stats = ref.region
                        ? recolor.analyzeReference(ref.image, ref.region)
                        : recolor.analyzeReferenceAuto(source.image.width, source.image.height, source.weight, ref.image);
                    // The native recipe uses color statistics only.
                    delete stats.selection;
                    analyzed.push({ ...ref, stats, message: stats.uncertain ? "请核对自动取色，必要时手动框选" : ref.region ? "手动取色完成" : "自动取色完成" });
                    count++;
                } catch (error) {
                    analyzed.push({ ...ref, stats: null, message: error.message, failed: true });
                }
            }
            setReferences(analyzed.map(ref => ref.stats ? { ...ref, failed: false } : ref));
            notify(count ? `已分析 ${count} 张参考图。` : "参考图分析失败，请查看各 SKU 的提示。", !count);
        });
    }

    function settings(ref) {
        return { matchMode: ref.mode, colorStrength: ref.strength / 100 };
    }

    function apply() {
        run("正在创建 Photoshop 调整层…", async () => {
            const items = ready.map(ref => ({
                name: ref.name.trim(),
                recipe: recolor.buildNativeRecipe({ src: source.stats, ref: ref.stats }, settings(ref)),
            }));
            const result = await invoke("retouch.apply", { ...source.target, items });
            clearSource();
            notify(`已在「${result.layerName}」创建 ${result.count} 个可编辑 SKU 组。首组可见，其余可在图层面板切换。`);
        });
    }

    return (
        <>
            <section className="wfa-retouch-card">
                <h2>调色原图</h2>
                <button type="button" disabled={!connected || busy} onClick={scanDocument}>扫描 Photoshop 文档</button>
                {document && <p className="wfa-retouch-hint">{document.name} · {document.width} × {document.height}</p>}
                {document?.groups.some(group => group.enabled) && <div className="wfa-retouch-actions">
                    <label className="wfa-retouch-field">服装蒙版组
                        <select value={groupId} disabled={busy} onChange={event => { setGroupId(event.target.value); clearSource(); }}>
                            {document.groups.map(group => <option key={group.id} value={group.id} disabled={!group.enabled}>{group.path}</option>)}
                        </select>
                    </label>
                    <button type="button" disabled={busy || !groupId} onClick={readSource}>读取原图</button>
                </div>}
            </section>
            <section className="wfa-retouch-card">
                <div className="wfa-retouch-heading">
                    <h2>SKU 参考图</h2>
                    <span>{references.length} / {LIMIT}</span>
                </div>
                <label className="wfa-retouch-field">批量添加 PNG、JPG 或 WebP
                    <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={importReferences} disabled={busy || references.length >= LIMIT} />
                </label>
                {references.length > 0 && <>
                    <ul className="wfa-retouch-list">
                        {references.map(ref => <li key={ref.id}>
                            <input type="checkbox" aria-label={`加入批次：${ref.name}`} checked={ref.enabled} disabled={busy}
                                onChange={event => updateReference(ref.id, { enabled: event.target.checked })} />
                            <button type="button" disabled={busy} aria-pressed={ref.id === selected} onClick={() => setSelected(ref.id)}>
                                <span>{ref.name || "未命名 SKU"}</span>
                                {ref.message && <small data-error={ref.failed || undefined}>{ref.message}</small>}
                            </button>
                            <button type="button" aria-label={`移除 ${ref.name}`} disabled={busy} onClick={() => {
                                const remaining = references.filter(item => item.id !== ref.id);
                                setReferences(remaining);
                                if (ref.id === selected) setSelected(remaining[0]?.id ?? null);
                            }}>×</button>
                        </li>)}
                    </ul>
                    {current && <>
                        <label className="wfa-retouch-field">SKU 名称
                            <input value={current.name} maxLength={160} disabled={busy} onChange={event => updateReference(current.id, { name: event.target.value })} />
                        </label>
                        <div className="wfa-retouch-actions">
                            <label className="wfa-retouch-field">调色方式
                                <select value={current.mode} disabled={busy} onChange={event => updateReference(current.id, { mode: event.target.value })}>
                                    {MODES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                                </select>
                            </label>
                            <label className="wfa-retouch-field">颜色强度 {current.strength}%
                                <input type="range" min="0" max="100" value={current.strength} disabled={busy} onChange={event => updateReference(current.id, { strength: Number(event.target.value) })} />
                            </label>
                        </div>
                        <p className="wfa-retouch-hint">自动取色有偏差时，可在参考图上拖框选中服装区域。</p>
                        <div className="wfa-retouch-images" role="group" aria-label={`${current.name || "当前 SKU"} 图像对比`}>
                            <figure>
                                <figcaption>SKU 参考图</figcaption>
                                <ReferencePreview key={current.id} reference={current} disabled={busy}
                                    onRegion={region => updateReference(current.id, { region, stats: null, message: "", failed: false })} />
                            </figure>
                            <figure>
                                <figcaption>调色效果</figcaption>
                                {comparison?.image ? <CanvasImage image={comparison.image} label="调色效果" /> :
                                    <p className="wfa-retouch-hint" role="status" data-error={Boolean(comparison?.error) || undefined}>
                                        {comparison?.error || (source && currentStats ? "正在生成预览…" : "分析当前 SKU 后显示")}
                                    </p>}
                            </figure>
                        </div>
                        {current.region && <button type="button" disabled={busy} onClick={() => updateReference(current.id, { region: null, stats: null, message: "", failed: false })}>恢复自动取色</button>}
                    </>}
                    <div className="wfa-retouch-actions">
                        <button type="button" disabled={busy || !source || !references.some(ref => ref.enabled && !ref.stats)} onClick={analyze}>分析参考图</button>
                        <button className="wfa-retouch-primary" type="button" disabled={busy || !source || !ready.length ||
                            references.some(ref => ref.enabled && (!ref.stats || !ref.name.trim()))} onClick={apply}>
                            写入 Photoshop（{ready.length}）
                        </button>
                    </div>
                </>}
            </section>
            {notice && <p role="status" className="wfa-retouch-notice" data-error={notice.error || undefined}>{notice.text}</p>}
        </>
    );
}

function QualityCheck({ connected }) {
    const [report, setReport] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function check() {
        setBusy(true);
        setReport(null);
        setError("");
        try {
            setReport(await invoke("retouch.check"));
        } catch (failure) {
            setError(failure.message || String(failure));
        } finally {
            setBusy(false);
        }
    }
    return <section className="wfa-retouch-card">
        <h2>成片质检</h2>
        <p className="wfa-retouch-hint">按白底商品图检查当前 Photoshop 合成图。</p>
        <button className="wfa-retouch-primary" type="button" disabled={!connected || busy} onClick={check}>{busy ? "正在检查…" : "检查当前文档"}</button>
        {error && <p role="status" data-error>{error}</p>}
        {report && <>
            <p role="status">{report.name} · {report.errors} 项未达标，{report.warns} 项建议复核</p>
            <ul className="wfa-retouch-report">
                {report.items.map(item => <li key={item.id} data-level={item.level}><strong>{item.name}</strong><span>{item.detail}</span></li>)}
            </ul>
        </>}
    </section>;
}

export function RetouchShell() {
    const [tool, setTool] = useState("recolor");
    const connected = isInWebView();
    return <div className="wfa-retouch">
        <WorkspaceHeader title="精修工具" />
        <nav className="wfa-retouch-tools" aria-label="精修工具">
            <button type="button" aria-pressed={tool === "recolor"} onClick={() => setTool("recolor")}>批量调色</button>
            <button type="button" aria-pressed={tool === "quality"} onClick={() => setTool("quality")}>成片质检</button>
            <button type="button" aria-pressed={tool === "cloth"} onClick={() => setTool("cloth")}>衣物美化</button>
        </nav>
        {!connected && <p className="wfa-retouch-notice">网页可查看界面与导入参考图。读取、调整及质检文档需在 Photoshop 面板中完成。</p>}
        <div hidden={tool !== "recolor"}><BatchRecolor connected={connected} /></div>
        <div hidden={tool !== "quality"}><QualityCheck connected={connected} /></div>
        <div hidden={tool !== "cloth"}><ClothTool connected={connected} /></div>
    </div>;
}

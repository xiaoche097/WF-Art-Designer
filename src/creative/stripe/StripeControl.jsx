import React, { useEffect, useMemo, useRef, useState } from "react";
import { isInWebView } from "../../bridge/uxpBridge.js";
import { storage } from "../../bridge/uxpShim.js";
import { analyzeStripes } from "./stripeAnalysis.js";
import { captureStripeImage, loadStripeFile } from "./stripeImage.js";
import { adjustStripeBands, stripeInstruction, stripePeriod, stripePixels, stripeTexturePng } from "./stripeTexture.js";
import "./StripeControl.css";

const full = { x: 0, y: 0, width: 1, height: 1 };
const initialRoi = { x: .18, y: .16, width: .64, height: .68 };
const whole = "all";
const pct = value => `${value * 100}%`;

function SampleRegion({ image, roi, onChange }) {
    const canvas = useRef(null);
    const anchor = useRef(null);
    const { width, height } = image.frame;
    useEffect(() => { canvas.current.getContext("2d").putImageData(image.frame, 0, 0); }, [image]);
    const position = event => {
        const box = canvas.current.getBoundingClientRect();
        return ["X", "Y"].map((axis, i) => Math.max(0, Math.min(1, (event[`client${axis}`] - box[i ? "top" : "left"]) / box[i ? "height" : "width"])));
    };
    return <div className="wfa-stripe-sample" style={{ maxInlineSize: `${Math.max(80, 245 * width / height)}px` }}
        onPointerDown={event => {
            if (event.button !== 0) return;
            anchor.current = position(event);
            event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
            if (!anchor.current) return;
            const [x1, y1] = anchor.current;
            const [x2, y2] = position(event);
            if (Math.abs(x1 - x2) > .02 && Math.abs(y1 - y2) > .02) {
                onChange({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
            }
        }} onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}>
        <canvas ref={canvas} width={width} height={height} role="img" aria-label="原图与条纹取样范围" />
        <span className="wfa-stripe-selection" aria-hidden="true" style={{
            left: pct(roi.x), top: pct(roi.y), width: pct(roi.width), height: pct(roi.height),
        }} />
    </div>;
}

const calibration = [
    ["x", "左侧"], ["y", "顶部"], ["width", "宽度"], ["height", "高度"],
];

function WidthInput({ label, value, step, onCommit }) {
    const [draft, setDraft] = useState(null);
    return <label>{label}<input type="number" step={step} value={draft ?? value}
        onChange={event => setDraft(event.target.value)} onBlur={() => {
            if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) onCommit(Number(draft));
            setDraft(null);
        }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

export function StripeControl({ onSend }) {
    const [image, setImage] = useState(null);
    const [roi, setRoi] = useState(initialRoi);
    const [scope, setScope] = useState("canvas");
    const [piece, setPiece] = useState("");
    const [angle, setAngle] = useState("");
    const [colorCount, setColorCount] = useState("");
    const [analysis, setAnalysis] = useState(null);
    const [scale, setScale] = useState(100);
    const [colorId, setColorId] = useState(whole);
    const [locked, setLocked] = useState(true);
    const [replacements, setReplacements] = useState({});
    const [busy, setBusy] = useState("");
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const pending = useRef(false);
    const instructionBox = useRef(null);
    const palette = analysis && [...new Map(analysis.bands.map(band => [band.id, band.color])).entries()].sort((a, b) => a[0] - b[0]);
    const target = useMemo(() => analysis && adjustStripeBands(analysis.bands, scale / 100, colorId, replacements), [analysis, scale, colorId, replacements]);
    const previews = useMemo(() => analysis && target && [
        stripeTexturePng(analysis.bands).toDataURL(), stripeTexturePng(target).toDataURL(),
    ], [analysis, target]);
    const instruction = analysis && stripeInstruction(piece.trim() || "当前圈选衣片", analysis, target);
    const currentWidth = analysis && (colorId === whole ? analysis.period : stripePeriod(analysis.bands.filter(item => item.id === colorId)));
    const commitScale = value => setScale(Math.max(25, Math.min(200, value)));

    function resetTarget() {
        setScale(100);
        setColorId(whole);
        setLocked(true);
        setReplacements({});
    }

    function changeSample(next) {
        if (pending.current) return;
        setRoi(next);
        setAnalysis(null);
        setError("");
        setNotice("");
    }

    async function run(label, work) {
        if (pending.current) return;
        pending.current = true;
        setBusy(label);
        setError("");
        setNotice("");
        try { await work(); }
        catch (failure) { setError(failure?.message || "条纹操作失败"); }
        finally { pending.current = false; setBusy(""); }
    }

    function load(read, region) {
        return run("正在读取图片…", async () => {
            const next = await read();
            setImage(next);
            setRoi(region);
            setAnalysis(null);
            resetTarget();
        });
    }

    function measure() {
        return run("正在分析条纹…", async () => {
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
            const result = analyzeStripes(image.frame, roi, {
                sourceWidth: image.sourceWidth, sourceHeight: image.sourceHeight,
                angle: angle.trim() === "" ? undefined : Number(angle),
                colors: Number(colorCount) || undefined,
            });
            if (result.reason) { setAnalysis(null); throw new Error(result.reason); }
            setAnalysis(result);
            resetTarget();
        });
    }

    function readStandard(file) {
        return run("正在读取标准纹理…", async () => {
            const standard = await loadStripeFile(file);
            const measured = analyzeStripes(standard.frame, full, {
                colors: palette.length, sourceWidth: standard.sourceWidth, sourceHeight: standard.sourceHeight,
            });
            if (measured.reason) throw new Error(measured.reason);
            const reference = new Map(measured.bands.map(band => [band.id, band.color]));
            setReplacements(Object.fromEntries(palette.map(([id]) => [id, reference.get(id)])));
            setNotice("已按颜色明暗顺序载入标准图配色。");
        });
    }

    function exportTile() {
        return run("正在导出纹理 PNG…", async () => {
            const folder = isInWebView() ? await storage.localFileSystem.getFolder() : null;
            if (isInWebView() && !folder) return;
            const canvas = stripeTexturePng(target);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            if (!blob) throw new Error("纹理 PNG 编码失败");
            const name = `WF-Stripe-${Date.now()}.png`;
            if (folder) {
                const file = await folder.createFile(name);
                await file.write(await blob.arrayBuffer(), { format: storage.formats.binary, overwrite: false });
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
            }
            setNotice(`已导出一个完整周期 · ${canvas.width} × ${canvas.height} PNG`);
        });
    }

    async function copyInstruction() {
        try {
            await navigator.clipboard.writeText(instruction);
            setNotice("已复制重构指令。");
        } catch (_) {
            instructionBox.current.focus();
            instructionBox.current.select();
            setNotice("指令已选中，按 Ctrl+C 复制。");
        }
    }

    return <div className="wfa-creative-stack wfa-stripe" aria-label="智能条纹重构">
        <section className="wfa-creative-card">
            <header className="wfa-stripe-heading"><h3>智能条纹重构</h3><small>Stripe Control</small></header>
            <label>导入原图<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void load(() => loadStripeFile(file), initialRoi);
            }} /></label>
            {isInWebView() && <div className="wfa-creative-buttons">
                <select aria-label="Photoshop 取图范围" value={scope} disabled={!!busy} onChange={event => setScope(event.target.value)}>
                    <option value="canvas">当前画布</option><option value="layer">当前图层</option><option value="selection">当前选区</option>
                </select>
                <button type="button" disabled={!!busy} onClick={() => load(() => captureStripeImage(scope), scope === "selection" ? full : initialRoi)}>读取 Photoshop</button>
            </div>}
            {image && <>
                <label>衣片名称<input value={piece} maxLength={60} placeholder="例如：衣身或袖口" onChange={event => setPiece(event.target.value)} /></label>
                <p>拖框选择平整的单块衣片，框入至少两组完整条纹。</p>
                <SampleRegion image={image} roi={roi} onChange={changeSample} />
                <details>
                    <summary>手动校准</summary>
                    <div className="wfa-creative-buttons">
                        {calibration.map(([key, label]) => <label key={key}>{label}（%）<input type="number" min={0} max={100} step="1"
                            value={Math.round(roi[key] * 100)} onChange={event => {
                                if (event.target.value === "") return;
                                const value = Math.min(1, Math.max(0, Number(event.target.value) / 100));
                                const next = { ...roi, [key]: value };
                                next.width = Math.min(next.width, 1 - next.x);
                                next.height = Math.min(next.height, 1 - next.y);
                                changeSample(next);
                            }} /></label>)}
                        <label>方向（°，0 为横纹）<input type="number" min="-90" max="90" value={angle} placeholder="自动"
                            onChange={event => { setAngle(event.target.value); setAnalysis(null); }} /></label>
                        <label>颜色数<select value={colorCount} onChange={event => { setColorCount(event.target.value); setAnalysis(null); }}>
                            <option value="">自动</option>{[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                        </select></label>
                    </div>
                </details>
                <button type="button" className="wfa-creative-primary" disabled={!!busy} onClick={measure}>分析条纹</button>
            </>}
        </section>
        {analysis && <section className="wfa-creative-card">
            <h3>纹理信息</h3>
            <dl className="wfa-stripe-metrics">
                <div><dt>取样颜色</dt><dd>{palette.length} 色</dd></div>
                <div><dt>排列方向</dt><dd>{stripePixels(analysis.angle)}°</dd></div>
                <div><dt>原始周期</dt><dd>{stripePixels(analysis.period)} px</dd></div>
                <div><dt>周期相关</dt><dd>{Math.round(analysis.correlation * 100)}%</dd></div>
            </dl>
            <details><summary>局部方向估计</summary><div className="wfa-stripe-field">
                {analysis.field.map(({ angle, coherence }, i) => <span key={i}>{coherence >= .45 ? `${Math.round(angle)}°` : "不明确"}</span>)}
            </div></details>
            <div className="wfa-creative-buttons">
                <div><small>原始纹理</small><div className="wfa-stripe-tile" role="img" aria-label="由取样参数生成的原始纹理"
                    style={{ backgroundImage: `url(${previews[0]})`, backgroundSize: "100% 32px" }} /></div>
                <div><small>目标纹理</small><div className="wfa-stripe-tile" role="img" aria-label="调整后的目标纹理"
                    style={{ backgroundImage: `url(${previews[1]})`, backgroundSize: `100% ${32 * stripePeriod(target) / analysis.period}px` }} /></div>
            </div>
            <label className="wfa-creative-guide-toggle"><input type="checkbox" checked={locked}
                onChange={event => { setLocked(event.target.checked); if (event.target.checked) { setColorId(whole); setScale(100); } }} />锁定各色宽度比例</label>
            <label>调整范围<select value={colorId} disabled={locked} onChange={event => {
                setColorId(event.target.value === whole ? whole : Number(event.target.value));
                setScale(100);
            }}><option value={whole}>整体调整</option>{palette.map(([id, color]) => <option key={id} value={id}>仅色组 {id + 1} · {color}</option>)}</select></label>
            <label>条纹宽度 · {Math.round(scale)}%<input type="range" min="25" max="200" value={scale}
                onChange={event => setScale(Number(event.target.value))} /></label>
            <div className="wfa-creative-buttons">
                <WidthInput label="宽度（%）" value={Math.round(scale)} step="1" onCommit={commitScale} />
                <WidthInput key={colorId} label={colorId === whole ? "目标周期（px）" : "所选颜色总宽（px）"}
                    value={stripePixels(currentWidth * scale / 100)} step=".01" onCommit={value => commitScale(value / currentWidth * 100)} />
            </div>
            <dl className="wfa-stripe-metrics">
                <div><dt>目标周期</dt><dd>{stripePixels(stripePeriod(target))} px</dd></div>
                <div><dt>相对密度</dt><dd>{(analysis.period / stripePeriod(target) * 100).toFixed(1)}%</dd></div>
            </dl>
            <table className="wfa-stripe-widths">
                <thead><tr><th>目标颜色</th><th>原宽 px</th><th>目标宽 px</th></tr></thead>
                <tbody>{target.map((band, i) => <tr key={i}>
                    <td><input type="color" aria-label={`第 ${i + 1} 条目标颜色`} value={band.color}
                        onChange={event => setReplacements({ ...replacements, [band.id]: event.target.value })} /> <small>{band.color}</small></td>
                    <td>{stripePixels(analysis.bands[i].width)}</td><td>{stripePixels(band.width)}</td>
                </tr>)}</tbody>
            </table>
            <details><summary>从标准条纹图取色</summary><label>导入含多个完整周期的标准图
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void readStandard(file);
                }} /></label></details>
            <div className="wfa-creative-buttons">
                <button type="button" disabled={!!busy} onClick={resetTarget}>恢复原始参数</button>
                <button type="button" className="wfa-creative-primary" disabled={!!busy} onClick={exportTile}>导出无缝 PNG</button>
            </div>
            <details><summary>精准重构指令</summary>
                <label>指令预览<textarea ref={instructionBox} value={instruction} rows={5} readOnly /></label>
                <div className="wfa-creative-buttons">
                    <button type="button" onClick={copyInstruction}>复制指令</button>
                    <button type="button" onClick={() => onSend(instruction)}>追加到织影</button>
                </div>
                <p>在织影中添加原图与导出的纹理 PNG 后，可使用这段指令。</p>
            </details>
        </section>}
        {(busy || notice) && <p role="status">{busy || notice}</p>}
        {error && <p role="alert">{error}</p>}
    </div>;
}

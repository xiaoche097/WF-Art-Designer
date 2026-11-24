import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { buildToneBands, combineToneBands, renderTone } from "../../plugin/host/retouch/clothTone.js";
import { ClothSliders } from "./ClothSliders.jsx";
import "./clothPreviewPage.css";

const send = message => window.uxpHost?.postMessage(message);
const decode = value => Uint8ClampedArray.from(atob(value), char => char.charCodeAt(0));

function draw(canvas, pixels, width, height) {
    const context = canvas.getContext("2d");
    const data = context.createImageData(width, height);
    data.data.set(pixels);
    context.putImageData(data, 0, 0);
}

function Workspace({ frame }) {
    const { pixels, mask, width, height } = frame;
    const [settings, setSettings] = useState(frame.settings);
    const [mode, setMode] = useState("split");
    const [split, setSplit] = useState(50);
    const [zoom, setZoom] = useState("fit");
    const [error, setError] = useState("");
    const original = useRef(null);
    const result = useRef(null);
    const bands = useMemo(() => buildToneBands(pixels, mask, width, height), [pixels, mask, width, height]);

    useLayoutEffect(() => draw(original.current, pixels, width, height), [pixels, width, height]);
    useLayoutEffect(() => {
        const request = requestAnimationFrame(() => {
            const field = combineToneBands(bands, settings);
            draw(result.current, renderTone(pixels, width, height, field, width, height, mask, 100), width, height);
        });
        return () => cancelAnimationFrame(request);
    }, [bands, pixels, width, height, mask, settings]);
    useLayoutEffect(() => {
        const receive = ({ data }) => { if (data?.type === "clothPreview.error") setError(data.message); };
        const escape = event => { if (event.key === "Escape") send({ type: "clothPreview.cancel" }); };
        window.addEventListener("message", receive);
        window.addEventListener("keydown", escape);
        return () => {
            window.removeEventListener("message", receive);
            window.removeEventListener("keydown", escape);
        };
    }, []);

    return <div className="cloth-workspace">
        <header className="cloth-toolbar">
            <div role="group" aria-label="对比方式">
                {[["split", "分屏对比"], ["before", "原图"], ["after", "效果"]].map(([key, label]) =>
                    <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
            </div>
            <div role="group" aria-label="预览缩放">
                {[["fit", "适合窗口"], ["actual", "预览 1:1"], ["double", "预览 2×"]].map(([key, label]) =>
                    <button key={key} type="button" aria-pressed={zoom === key} onClick={() => setZoom(key)}>{label}</button>)}
            </div>
        </header>
        <div className="cloth-stage" data-zoom={zoom}>
            <div className="cloth-photo" style={{
                "--photo-width": `${width}px`, "--photo-height": `${height}px`, "--photo-ratio": width / height,
                "--preview-scale": zoom === "double" ? 2 : 1, "--split": `${split}%`,
            }} data-mode={mode}>
                <canvas ref={original} width={width} height={height} aria-label="原始图像" />
                <canvas ref={result} width={width} height={height} aria-label="衣物美化后的图像" />
                {mode === "split" && <>
                    <div className="cloth-divider" aria-hidden="true" />
                    <span className="cloth-image-label">原图</span>
                    <span className="cloth-image-label cloth-result-label">效果</span>
                </>}
            </div>
        </div>
        <aside className="cloth-inspector">
            <h1>衣物调整</h1>
            <ClothSliders settings={settings} onChange={(key, value) =>
                setSettings(current => current[key] === value ? current : { ...current, [key]: value })} />
            {mode === "split" && <label className="wfa-cloth-strength">
                <span>对比分界 <output>{split}%</output></span>
                <input aria-label="对比分界" type="range" min="0" max="100" value={split}
                    onInput={event => setSplit(Number(event.currentTarget.value))}
                    onChange={event => setSplit(Number(event.currentTarget.value))} />
            </label>}
            <button type="button" onClick={() => setSettings({ fine: 0, coarse: 0 })}>重置调整</button>
            {error && <p role="alert">{error}</p>}
        </aside>
        <footer className="cloth-footer">
            <span>预览 ${width} × ${height} · 写入原图尺寸 ${frame.originalWidth} × ${frame.originalHeight}</span>
            <div>
                <button type="button" onClick={() => send({ type: "clothPreview.cancel" })}>取消</button>
                <button type="button" className="cloth-confirm" disabled={!settings.fine && !settings.coarse}
                    onClick={() => send({ type: "clothPreview.confirm", settings })}>应用到 Photoshop</button>
            </div>
        </footer>
    </div>;
}

const root = document.getElementById("cloth-preview-root");
root.textContent = "正在生成预览…";
window.addEventListener("message", ({ data }) => {
    if (data?.type !== "clothPreview.data") return;
    const { payload } = data;
    ReactDOM.render(<Workspace frame={{ ...payload, pixels: decode(payload.rgba), mask: decode(payload.mask) }} />, root);
});
send({ type: "clothPreview.ready" });

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { buildToneBands, combineToneBands, renderTone } from "../../plugin/host/retouch/clothTone.js";
import { ClothSliders, getClothParts } from "./ClothSliders.jsx";
import "./clothPreviewPage.css";

const decode = value => {
    const decoded = Uint8Array.fromBase64?.(value);
    return decoded ? new Uint8ClampedArray(decoded.buffer) : Uint8ClampedArray.from(atob(value), char => char.charCodeAt(0));
};

function draw(canvas, pixels, width, height) {
    const context = canvas.getContext("2d");
    const data = context.createImageData(width, height);
    data.data.set(pixels);
    context.putImageData(data, 0, 0);
}

function Workspace({ frame }) {
    const { pixels, mask, width, height, regions, nonce } = frame;
    const send = message => window.uxpHost?.postMessage({ ...message, nonce });
    const [settings, setSettings] = useState(frame.settings);
    const [mode, setMode] = useState("split");
    const [split, setSplit] = useState(50);
    const [zoom, setZoom] = useState("fit");
    const [showMask, setShowMask] = useState(false);
    const [error, setError] = useState("");
    const original = useRef(null);
    const result = useRef(null);
    const maskCanvas = useRef(null);
    const bands = useMemo(() => buildToneBands(pixels, mask, width, height), [pixels, mask, width, height]);
    const parts = useMemo(() => getClothParts(mask, regions), [mask, regions]);

    useLayoutEffect(() => draw(original.current, pixels, width, height), [pixels, width, height]);
    useLayoutEffect(() => {
        if (!showMask) return;
        const colors = new Uint8ClampedArray(mask.length * 4);
        for (let p = 0; p < mask.length; p++) {
            const lower = regions?.[p] === 2;
            colors[p * 4] = lower ? 255 : 70;
            colors[p * 4 + 1] = lower ? 174 : 164;
            colors[p * 4 + 2] = lower ? 48 : 255;
            colors[p * 4 + 3] = mask[p] * .45;
        }
        draw(maskCanvas.current, colors, width, height);
    }, [mask, regions, width, height, showMask]);
    useLayoutEffect(() => {
        const request = requestAnimationFrame(() => {
            const field = combineToneBands(bands, settings, regions);
            draw(result.current, renderTone(pixels, width, height, field, width, height, mask, 100), width, height);
        });
        return () => cancelAnimationFrame(request);
    }, [bands, pixels, width, height, mask, settings, regions]);
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
                {showMask && <canvas ref={maskCanvas} width={width} height={height} aria-label="衣物识别区域蒙版" />}
                {mode === "split" && <>
                    <div className="cloth-divider" aria-hidden="true" />
                    <span className="cloth-image-label">原图</span>
                    <span className="cloth-image-label cloth-result-label">效果</span>
                </>}
            </div>
        </div>
        <aside className="cloth-inspector">
            <h1>衣物调整</h1>
            <ClothSliders settings={settings} parts={parts} onChange={(key, value) =>
                setSettings(current => current[key] === value ? current : { ...current, [key]: value })} />
            <label className="cloth-mask-toggle"><input type="checkbox" checked={showMask}
                onChange={event => setShowMask(event.target.checked)} />查看衣物识别区域</label>
            {showMask && <p className="cloth-mask-key">蓝色为上装或连衣裙，橙色为下装。</p>}
            {mode === "split" && <label className="wfa-cloth-strength">
                <span>对比分界 <output>{split}%</output></span>
                <input aria-label="对比分界" type="range" min="0" max="100" value={split}
                    onInput={event => setSplit(Number(event.currentTarget.value))}
                    onChange={event => setSplit(Number(event.currentTarget.value))} />
            </label>}
            <button type="button" onClick={() => setSettings({ upper: 100, lower: 100, fine: 0, coarse: 0 })}>重置调整</button>
            {error && <p role="alert">{error}</p>}
        </aside>
        <footer className="cloth-footer">
            <span>预览 ${width} × ${height} · 写入原图尺寸 ${frame.originalWidth} × ${frame.originalHeight}</span>
            <div>
                <button type="button" onClick={() => send({ type: "clothPreview.cancel" })}>取消</button>
                <button type="button" className="cloth-confirm" disabled={(!settings.fine && !settings.coarse) ||
                    !((parts.upper || parts.dress) && settings.upper || parts.lower && settings.lower)}
                    onClick={() => send({ type: "clothPreview.confirm", settings })}>应用到 Photoshop</button>
            </div>
        </footer>
    </div>;
}

const root = document.getElementById("cloth-preview-root");
try {
    const payload = JSON.parse(document.getElementById("cloth-data").textContent);
    ReactDOM.render(<Workspace frame={{ ...payload, pixels: decode(payload.rgba), mask: decode(payload.mask),
        regions: payload.regions ? decode(payload.regions) : null }} />, root);
} catch (error) {
    root.textContent = "无法加载大图。请关闭窗口，在插件面板查看预览或生成图层。";
    console.error("[WF] Clothing preview failed", error);
}

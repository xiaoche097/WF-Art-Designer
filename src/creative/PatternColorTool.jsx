import React, { useEffect, useMemo, useRef, useState } from "react";
import { referenceFromFile } from "../retouch/recolorImages.js";
import { recolorPattern } from "./patternRecolor.js";

function paint(canvas, frame) {
    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
}

function targetRgb(color) {
    return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

export function PatternColorTool({ onInspect }) {
    const [original, setOriginal] = useState(null);
    const [source, setSource] = useState("#000000");
    const [target, setTarget] = useState("#527bd4");
    const [tolerance, setTolerance] = useState(45);
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const before = useRef(null);
    const after = useRef(null);
    const output = useMemo(() => original && recolorPattern(original.preview, targetRgb(source), targetRgb(target), tolerance), [original, source, target, tolerance]);
    useEffect(() => { if (original) paint(before.current, original.preview); }, [original]);
    useEffect(() => { if (output) paint(after.current, output); }, [output]);

    async function run(label, task) {
        setBusy(label);
        setError("");
        try { await task(); }
        catch (failure) { setError(failure.message || "处理花型失败"); }
        finally { setBusy(""); }
    }

    async function inspect() {
        await run("正在处理图稿…", async () => {
            const frame = await referenceFromFile(original.file, 2400);
            const recolored = recolorPattern(frame, targetRgb(source), targetRgb(target), tolerance);
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            paint(canvas, recolored);
            onInspect(canvas.toDataURL("image/png"), "本地改色");
        });
    }

    function sample(event) {
        const frame = original.preview;
        const bounds = before.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(frame.width - 1, Math.floor((event.clientX - bounds.left) * frame.width / bounds.width)));
        const y = Math.max(0, Math.min(frame.height - 1, Math.floor((event.clientY - bounds.top) * frame.height / bounds.height)));
        const offset = (y * frame.width + x) * 4;
        if (!frame.data[offset + 3]) return;
        setSource("#" + Array.from(frame.data.subarray(offset, offset + 3), value => value.toString(16).padStart(2, "0")).join(""));
    }

    return <section className="wfa-creative-card" aria-label="本地花型改色">
        <h3>本地花型改色</h3>
        <label>导入图案<input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run("正在读取图案…", async () => {
                const preview = await referenceFromFile(file);
                setOriginal({ file, preview });
            });
        }} /></label>
        {original && <>
            <div className="wfa-creative-buttons">
                <label>原图取色<canvas className="wfa-creative-swatch-image is-picker" ref={before} width={output.width} height={output.height} onClick={sample} /></label>
                <label>改色预览<canvas className="wfa-creative-swatch-image" ref={after} width={output.width} height={output.height} /></label>
                <label>原色<input type="color" value={source} onChange={event => setSource(event.target.value)} /></label>
                <label>目标色<input type="color" value={target} onChange={event => setTarget(event.target.value)} /></label>
            </div>
            <label>色差范围 · {tolerance}<input type="range" min="1" max="160" value={tolerance} onChange={event => setTolerance(Number(event.target.value))} /></label>
            <button type="button" className="wfa-creative-primary" disabled={Boolean(busy)} onClick={inspect}>应用改色并验缝</button>
        </>}
        {busy && <p role="status">{busy}</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

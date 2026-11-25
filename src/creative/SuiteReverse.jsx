import React, { useEffect, useRef, useState } from "react";
import { runBananaVision } from "../banana/bananaApi.js";
import { parseReverseSuite, prepareCreativeImage, readCreativeProfile, reversePrompt } from "./creativeWorkflows.js";

const MAX_REFERENCES = 8;

export function SuiteReverse({ onSave, model, setModel }) {
    const [images, setImages] = useState([]);
    const [suite, setSuite] = useState(null);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const controller = useRef(null);
    const loading = progress === "正在读取参考图…";
    useEffect(() => () => controller.current?.abort(), []);

    async function load(event) {
        const files = Array.from(event.target.files || []).slice(0, MAX_REFERENCES);
        event.target.value = "";
        if (!files.length) return;
        setError("");
        setProgress("正在读取参考图…");
        try {
            const next = [];
            for (const file of files) next.push(await prepareCreativeImage(file, 768));
            setImages(next);
            setSuite(null);
        } catch (failure) { setError(failure.message); }
        finally { setProgress(""); }
    }

    async function analyze() {
        if (controller.current) return;
        const request = new AbortController();
        controller.current = request;
        setError("");
        setSuite(null);
        setProgress("正在分析套图…");
        try {
            const profile = readCreativeProfile();
            if (!profile?.apiKey) throw new Error("请先在织影账户管理配置可用的供应商");
            const output = await runBananaVision(profile, { model: model.trim(), prompt: reversePrompt, images, signal: request.signal });
            if (!request.signal.aborted) setSuite(parseReverseSuite(output, images.length));
        } catch (failure) {
            if (!request.signal.aborted) setError(failure.message || "套图分析失败");
        } finally {
            controller.current = null;
            setProgress(request.signal.aborted ? "已取消分析。" : "");
        }
    }

    return <section className="wfa-creative-card" aria-label="套图反推">
        <h3>套图反推</h3>
        <label>参考套图（最多 {MAX_REFERENCES} 张）
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={loading || Boolean(controller.current)} onChange={load} />
        </label>
        {images.length > 0 && <ol className="wfa-creative-thumbnails" aria-label="反推顺序">
            {images.map((image, index) => <li key={index}><img src={image.url} alt={image.fileName} /><span>{index + 1}</span></li>)}
        </ol>}
        <label>视觉模型 ID
            <input value={model} maxLength={200} placeholder="填写当前织影供应商的视觉理解模型" onChange={event => setModel(event.target.value)} disabled={Boolean(controller.current)} />
        </label>
        <button className="wfa-creative-primary" type="button" disabled={!images.length || !model.trim() || loading || Boolean(controller.current)}
            onClick={analyze}>分析参考套图</button>
        {controller.current && <button type="button" onClick={() => controller.current?.abort()}>取消分析</button>}
        {progress && <p role="status">{progress}</p>}
        {error && <p role="alert">{error}</p>}
        {suite && <>
            <label>模板名称<input value={suite.name} maxLength={80} onChange={event => setSuite({ ...suite, name: event.target.value })} /></label>
            <p>{suite.style}</p>
            <ol className="wfa-creative-outline">{suite.shots.map(shot => <li key={shot.id}>{shot.title}</li>)}</ol>
            <button className="wfa-creative-primary" type="button" disabled={!suite.name.trim()} onClick={() => {
                onSave(suite);
                setSuite(null);
                setProgress("已存入套图方案，可在套图分镜中使用。");
            }}>保存套图方案</button>
        </>}
    </section>;
}

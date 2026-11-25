import React, { useEffect, useRef, useState } from "react";
import { runBananaVision } from "../banana/bananaApi.js";
import { prepareCreativeImage, readCreativeProfile } from "./creativeWorkflows.js";

export function PatternListing({ file, model, setModel }) {
    const [market, setMarket] = useState("");
    const [facts, setFacts] = useState("");
    const [language, setLanguage] = useState("英语");
    const [listing, setListing] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const active = useRef(null);
    useEffect(() => () => active.current?.abort(), []);

    async function createListing() {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        setListing("");
        setError("");
        try {
            const profile = readCreativeProfile();
            if (!profile?.apiKey) throw new Error("请先在织影账户管理配置供应商");
            const image = await prepareCreativeImage(file, 768);
            const prompt = [
                "根据所附花型图和下列已知事实，起草电商 Listing。",
                `渠道与地区：${market.trim()}。文案语种：${language}。`,
                `已知商品事实：${facts.trim() || "未提供，只描述图中可见图案和配色。"}`,
                "输出一段商品标题、三条卖点和一组可检索关键词。不能根据花型图推断材质、尺码、认证、性能或商品用途。",
            ].join("\n");
            const result = await runBananaVision(profile, { model: model.trim(), prompt, images: [image], signal: controller.signal });
            if (!controller.signal.aborted) setListing(result);
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure.message || "文案生成失败");
        } finally {
            active.current = null;
            setBusy(false);
        }
    }

    return <details>
        <summary>生成跨境 Listing</summary>
        <label>渠道与地区<input value={market} maxLength={100} placeholder="例如 Amazon 美国站" onChange={event => setMarket(event.target.value)} /></label>
        <label>已知商品事实<textarea rows={2} value={facts} maxLength={800} onChange={event => setFacts(event.target.value)} /></label>
        <label>文案语种<select value={language} onChange={event => setLanguage(event.target.value)}>
            {["英语", "简体中文", "日语", "德语", "法语", "西班牙语"].map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label>视觉模型 ID<input value={model} disabled={busy} maxLength={200} onChange={event => setModel(event.target.value)} /></label>
        <button type="button" disabled={busy || !market.trim() || !model.trim()} onClick={createListing}>{busy ? "正在生成文案…" : "生成 Listing 文案"}</button>
        {busy && <button type="button" onClick={() => active.current?.abort()}>取消</button>}
        {listing && <label>编辑文案<textarea rows={8} value={listing} onChange={event => setListing(event.target.value)} /></label>}
        {error && <p role="alert">{error}</p>}
    </details>;
}

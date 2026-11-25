import React, { useEffect, useRef, useState } from "react";
import { WorkspaceHeader } from "../components/WorkspaceHeader.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { referenceFromFile } from "../retouch/recolorImages.js";
import { buildStoryboard, creativeSuites } from "./storyboard.js";
import { analyzeTileSeams } from "./tileSeams.js";
import { EcomGenWorkspace } from "./EcomGenWorkspace.jsx";
import "./CreativeCenter.css";

const initialProject = { suiteId: "launch", product: "", facts: "", market: "", language: "简体中文", artDirection: "" };

function Storyboard({ onSend }) {
    const [stored, setStored] = usePersistedState("wfa_creative_storyboard_v1", initialProject);
    const project = { ...initialProject, ...stored };
    const shots = buildStoryboard(project);
    const selected = shots.find(shot => shot.id === project.activeShot) || shots[0];
    const shotKey = selected && `${project.suiteId}:${selected.id}`;
    const draft = project.edits?.[shotKey] ?? selected?.prompt ?? "";
    const update = (key, value) => setStored(current => ({ ...initialProject, ...current, [key]: value }));

    const fields = [
        ["market", "渠道与市场", "例如：Amazon 美国站", 120],
        ["artDirection", "视觉方向", "例如：暖白棚拍、柔和侧光", 240],
    ];
    return <div className="wfa-creative-stack">
        <section className="wfa-creative-card" aria-label="商品与套图">
            <h3>商品与套图</h3>
            <label>套图方案
                <select value={project.suiteId} onChange={event => update("suiteId", event.target.value)}>
                    {creativeSuites.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
            </label>
            <label>商品名称
                <input value={project.product} placeholder="例如：米白色圆领 T 恤" maxLength={100}
                    onChange={event => update("product", event.target.value)} />
            </label>
            <label>已知商品事实
                <textarea rows={2} value={project.facts} maxLength={800}
                    placeholder="填写实物已确认的材质、版型或尺寸"
                    onChange={event => update("facts", event.target.value)} />
            </label>
            <details>
                <summary>渠道与画面设置</summary>
                {fields.map(([key, label, placeholder, limit]) => <label key={key}>{label}
                    <input value={project[key]} placeholder={placeholder} maxLength={limit}
                        onChange={event => update(key, event.target.value)} />
                </label>)}
                <label>文案语种
                    <select value={project.language} onChange={event => update("language", event.target.value)}>
                        {["简体中文", "英语", "日语", "德语", "法语", "西班牙语"].map(language => <option key={language}>{language}</option>)}
                    </select>
                </label>
            </details>
        </section>
        <section className="wfa-creative-card" aria-label="分镜与提示词">
            <h3>分镜</h3>
            {!selected ? <p>填写商品名称后，即可编辑这套图的分镜。</p> : <>
                <ul className="wfa-creative-shots" aria-label="分镜列表">
                    {shots.map(shot => <li key={shot.id}>
                        <button type="button" aria-pressed={selected.id === shot.id} onClick={() => update("activeShot", shot.id)}>
                            <span>{shot.title}</span><small>{shot.detail}</small>
                        </button>
                    </li>)}
                </ul>
                <label>编辑「{selected.title}」提示词
                    <textarea rows={5} value={draft} maxLength={8000}
                        onChange={event => update("edits", { ...project.edits, [shotKey]: event.target.value })} />
                </label>
                <div className="wfa-creative-actions">
                    {Object.hasOwn(project.edits ?? {}, shotKey) && <button type="button" onClick={() => {
                        const edits = { ...project.edits };
                        delete edits[shotKey];
                        update("edits", edits);
                    }}>恢复模板</button>}
                    <button type="button" className="wfa-creative-primary" disabled={!draft.trim()}
                        onClick={() => onSend(draft.trim())}>追加到织影</button>
                </div>
            </>}
        </section>
    </div>;
}

function PatternCheck() {
    const [result, setResult] = useState(null);
    const [status, setStatus] = useState("");
    const [showGuides, setShowGuides] = useState(true);
    const sequence = useRef(0);
    const canvas = useRef(null);
    useEffect(() => {
        if (!result) return;
        const context = canvas.current.getContext("2d");
        const { frame } = result;
        for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
            context.putImageData(frame, col * frame.width, row * frame.height);
        }
    }, [result]);

    async function loadPattern(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = "";
        const job = ++sequence.current;
        setResult(null);
        setStatus("正在检查花型…");
        try {
            const frame = await referenceFromFile(file);
            if (sequence.current !== job) return;
            setResult({ frame, name: file.name, report: analyzeTileSeams(frame) });
            setStatus("");
        } catch (error) {
            if (sequence.current === job) setStatus(error.message || "花型读取失败。");
        }
    }

    return <section className="wfa-creative-card" aria-label="花型验缝">
        <h3>花型验缝</h3>
        <label>选择 PNG、JPG 或 WebP
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={loadPattern} />
        </label>
        {status && <p role="status">{status}</p>}
        {result && <>
            <div className="wfa-creative-seam-summary" role="status">
                <strong>{result.report.noticeable ? "检测到明显接缝" : "未检测到明显接缝"}</strong>
                <span title={result.name}>{result.name}</span>
            </div>
            <dl className="wfa-creative-seam-axes">
                {[["左右", result.report.leftRight], ["上下", result.report.topBottom]].map(([name, axis]) => <div key={name}>
                    <dt>{name}接缝</dt><dd>{axis.noticeable ? "建议检查" : "过渡正常"}</dd>
                </div>)}
            </dl>
            <label className="wfa-creative-guide-toggle">
                <input type="checkbox" checked={showGuides} onChange={event => setShowGuides(event.target.checked)} />显示接缝辅助线
            </label>
            <div className="wfa-creative-tile" data-guides={showGuides || undefined}>
                <canvas ref={canvas} width={result.frame.width * 2} height={result.frame.height * 2}
                    role="img" aria-label="花型四宫格平铺预览" />
            </div>
            <p>按缩放图像估算边缘过渡，用四宫格复核细节。</p>
        </>}
    </section>;
}

export function CreativeCenter({ onSend, active }) {
    const [page, setPage] = useState("ecomgen");
    return <div className="wfa-creative">
        <WorkspaceHeader title="创意中心" />
        <div className="wfa-creative-body">
            <div className="wfa-creative-tabs" role="group" aria-label="创意功能">
                {[["ecomgen", "完整工作台"], ["storyboard", "套图分镜"], ["pattern", "花型验缝"]].map(([id, title]) =>
                    <button key={id} type="button" aria-pressed={page === id} onClick={() => setPage(id)}>{title}</button>)}
            </div>
            <div hidden={page !== "ecomgen"}><EcomGenWorkspace active={active && page === "ecomgen"} /></div>
            <div hidden={page !== "storyboard"}><Storyboard onSend={onSend} /></div>
            <div hidden={page !== "pattern"}><PatternCheck /></div>
        </div>
    </div>;
}

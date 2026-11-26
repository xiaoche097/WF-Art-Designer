import React, { useEffect, useRef, useState } from "react";
import { WorkspaceHeader } from "../components/WorkspaceHeader.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { referenceFromFile } from "../retouch/recolorImages.js";
import { storage } from "../bridge/uxpShim.js";
import { isInWebView } from "../bridge/uxpBridge.js";
import { loadResultImageBytes } from "../utils/imageSaver.js";
import { setPngDpi } from "../../plugin/host/wfArtAssistantPngCodec.js";
import { buildStoryboard, creativeSuites } from "./storyboard.js";
import { analyzeTileSeams } from "./tileSeams.js";
import { CreativeImageTool } from "./CreativeImageTool.jsx";
import { SuiteReverse } from "./SuiteReverse.jsx";
import { CreativeAssetLibrary } from "./CreativeAssetLibrary.jsx";
import { SuiteDelivery } from "./SuiteDelivery.jsx";
import { PatternColorTool } from "./PatternColorTool.jsx";
import { PatternListing } from "./PatternListing.jsx";
import "./CreativeCenter.css";

const initialProject = { suiteId: "launch", product: "", facts: "", market: "", language: "简体中文", artDirection: "", approved: {}, referenceId: "" };

function Storyboard({ project, onUpdate, onSend, templates, assets, onSaved, imageRequestRef }) {
    const shots = buildStoryboard(project, templates.find(template => template.id === project.suiteId));
    const selected = shots.find(shot => shot.id === project.activeShot) || shots[0];
    const shotKey = selected && `${project.suiteId}:${selected.id}`;
    const draft = project.edits?.[shotKey] ?? selected?.prompt ?? "";
    const update = (key, value) => onUpdate(current => ({ ...current, [key]: value }));
    const asset = assets.find(item => item.id === project.referenceId);

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
                    {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
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
            <label>项目参考图
                <select value={asset?.id || ""} onChange={event => update("referenceId", event.target.value)}>
                    <option value="">在分镜中单独导入</option>
                    {assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
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
                            <span>{shot.title}</span><small>{project.approved?.[`${project.suiteId}:${shot.id}`] ? "已通过审核" : shot.detail}</small>
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
        {selected && <CreativeImageTool key={shotKey} label={selected.title} prompt={draft} asset={asset} imageRequestRef={imageRequestRef}
            onSaved={onSaved} onApprove={image => onUpdate(current => ({
                ...current, approved: { ...current.approved, [shotKey]: image },
            }))} assetType="suite" requireReference />}
    </div>;
}

function PatternCheck({ incoming, model, setModel }) {
    const [result, setResult] = useState(null);
    const [status, setStatus] = useState("");
    const [showGuides, setShowGuides] = useState(true);
    const [paper, setPaper] = useState({ width: "20", height: "20", repeat: "5" });
    const [exporting, setExporting] = useState(false);
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

    async function loadPattern(getFile) {
        const job = ++sequence.current;
        setResult(null);
        setStatus("正在检查花型…");
        try {
            const file = await getFile();
            const frame = await referenceFromFile(file);
            if (sequence.current !== job) return;
            setResult({ file, frame, name: file.name, report: analyzeTileSeams(frame) });
            setStatus("");
        } catch (error) {
            if (sequence.current === job) setStatus(error.message || "花型读取失败。");
        }
    }
    useEffect(() => {
        if (!incoming) return;
        void loadPattern(async () => {
            const { buffer, ext } = await loadResultImageBytes(incoming.url);
            return new File([buffer], `${incoming.name}.${ext}`);
        });
    }, [incoming]);

    async function exportPattern() {
        const cm = value => Math.round(Number(value) * 300 / 2.54);
        const width = cm(paper.width), height = cm(paper.height), repeat = cm(paper.repeat);
        if (![width, height, repeat].every(value => Number.isInteger(value) && value > 0 && value <= 6500) || width * height > 12000000) {
            setStatus("请调整输出尺寸。单边上限约 55 cm，合计最多 1200 万像素。");
            return;
        }
        setExporting(true);
        setStatus("");
        try {
            const folder = isInWebView() ? await storage.localFileSystem.getFolder() : null;
            if (isInWebView() && !folder) return;
            const original = await referenceFromFile(result.file, 2400);
            const scaled = document.createElement("canvas");
            scaled.width = original.width;
            scaled.height = original.height;
            scaled.getContext("2d").putImageData(original, 0, 0);
            const tile = document.createElement("canvas");
            tile.width = repeat;
            tile.height = Math.max(1, Math.round(repeat * original.height / original.width));
            if (tile.height > 6500 || tile.width * tile.height > 12000000) throw new Error("重复单元太大，请减小单元宽");
            tile.getContext("2d").drawImage(scaled, 0, 0, tile.width, tile.height);
            const output = document.createElement("canvas");
            output.width = width;
            output.height = height;
            const context = output.getContext("2d");
            context.fillStyle = context.createPattern(tile, "repeat");
            context.fillRect(0, 0, width, height);
            const blob = await new Promise(resolve => output.toBlob(resolve, "image/png"));
            if (!blob || blob.size > 12 * 1024 * 1024) throw new Error("PNG 过大，请减小输出尺寸");
            const png = setPngDpi(new Uint8Array(await blob.arrayBuffer()), 300);
            const name = `花型平铺-300dpi-${width}x${height}-${Date.now()}.png`;
            if (folder) {
                const file = await folder.createFile(name);
                await file.write(png, { format: storage.formats.binary, overwrite: false });
            } else {
                const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
                const link = document.createElement("a");
                link.href = url;
                link.download = name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            setStatus(`已导出 300 DPI PNG（${width} × ${height}）。`);
        } catch (error) { setStatus(error.message || "花型导出失败"); }
        finally { setExporting(false); }
    }

    return <section className="wfa-creative-card" aria-label="花型验缝">
        <h3>花型验缝</h3>
        <label>选择 PNG、JPG 或 WebP
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={exporting} onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void loadPattern(() => file);
            }} />
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
            <details>
                <summary>导出印花规格</summary>
                <div className="wfa-creative-buttons">
                    {[["width", "成品宽 cm"], ["height", "成品高 cm"], ["repeat", "单元宽 cm"]].map(([key, label]) => <label key={key}>{label}
                        <input type="number" min="0.1" max="55" step="0.1" value={paper[key]} onChange={event => setPaper({ ...paper, [key]: event.target.value })} />
                    </label>)}
                </div>
                <button type="button" disabled={exporting} onClick={exportPattern}>{exporting ? "正在导出…" : "导出 300 DPI 平铺 PNG"}</button>
            </details>
            <PatternListing key={sequence.current} file={result.file} model={model} setModel={setModel} />
        </>}
    </section>;
}

const patternTasks = {
    extract: ["从商品图提取", "将参考商品图中真实存在的印花还原成平面图稿。去掉商品轮廓、褶皱、阴影与背景，保持图案轮廓、内部细节、配色与重复规律，输出单张平面图稿。"],
    draft: ["按主题起稿", "生成一张可作为重复单元使用的平面印花原稿。保持四边连续，均匀分布图案，去掉样机、文字、水印与边框。"],
    recolor: ["按要求改色", "只修改指定颜色。保留原图案轮廓、纹样密度、元素相对位置与接缝关系，输出一张完整平面图稿。"],
    variant: ["衍生新款", "基于参考图的主题和风格创作可平铺的新款，输出平面图稿，无产品样机、文字、水印或边框。"],
};

function PatternStudio({ asset, onSaved, model, setModel, imageRequestRef }) {
    const [tool, setTool] = useState("ai");
    const [mode, setMode] = useState("extract");
    const [notes, setNotes] = useState("");
    const [inspection, setInspection] = useState(null);
    const [label, instruction] = patternTasks[mode];
    const prompt = mode === "draft" && !notes.trim() ? "" : [instruction, notes.trim()].filter(Boolean).join("\n");
    const inspect = (url, name) => { setInspection({ url, name }); setTool("proof"); };
    return <div className="wfa-creative-stack">
        <div className="wfa-creative-buttons wfa-creative-suite-tools" role="group" aria-label="花型工具">
            {[["ai", "AI 花型"], ["color", "本地改色"], ["proof", "验缝与规格"]].map(([id, title]) =>
                <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}>{title}</button>)}
        </div>
        <div hidden={tool !== "ai"}><div className="wfa-creative-stack">
        <section className="wfa-creative-card" aria-label="花型工坊">
            <h3>花型工坊</h3>
            <label>操作
                <select value={mode} onChange={event => setMode(event.target.value)}>
                    {Object.entries(patternTasks).map(([id, [title]]) => <option key={id} value={id}>{title}</option>)}
                </select>
            </label>
            <label>{mode === "draft" ? "印花主题" : "图案要求"}
                <textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} />
            </label>
        </section>
        <CreativeImageTool label={label} prompt={prompt} asset={asset} onSaved={onSaved} assetType="pattern" imageRequestRef={imageRequestRef} requireReference={mode !== "draft"}
            onInspect={inspect} />
        </div></div>
        <div hidden={tool !== "color"}><PatternColorTool onInspect={inspect} /></div>
        <div hidden={tool !== "proof"}><PatternCheck incoming={inspection} model={model} setModel={setModel} /></div>
    </div>;
}

function ModelStudio({ asset, onSaved, imageRequestRef }) {
    const [description, setDescription] = useState("");
    const [pose, setPose] = useState("正面半身");
    const prompt = `以参考照片中的成年模特为定妆参考。保持面部身份、肤色、发型与五官比例稳定。本次拍摄：${pose}。${description.trim()}。保持商业摄影的真实肤质和自然动作，输出单张图片。`;
    return <div className="wfa-creative-stack">
        <section className="wfa-creative-card" aria-label="模特定妆">
            <h3>模特定妆</h3>
            <label>机位与构图
                <select value={pose} onChange={event => setPose(event.target.value)}>
                    {["正面半身", "四分之三侧面", "自然站姿全身", "行走全身", "棚拍面部特写"].map(item => <option key={item}>{item}</option>)}
                </select>
            </label>
            <label>服装与拍摄要求
                <textarea rows={2} value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} />
            </label>
        </section>
        <CreativeImageTool label="生成定妆参考" prompt={prompt} asset={asset} onSaved={onSaved} assetType="model" imageRequestRef={imageRequestRef} requireReference />
    </div>;
}

export function CreativeCenter({ onSend, imageRequestRef }) {
    const [page, setPage] = useState("storyboard");
    const [suiteTool, setSuiteTool] = useState("shots");
    const [templates, setTemplates] = usePersistedState("wfa_creative_suite_templates", []);
    const [assets, setAssets] = usePersistedState("wfa_creative_assets_v1", []);
    const [visionModel, setVisionModel] = usePersistedState("wfa_creative_vision_model", "");
    const [legacy] = usePersistedState("wfa_creative_storyboard_v1", initialProject);
    const [projects, setProjects] = usePersistedState("wfa_creative_projects_v1", () => [
        { ...initialProject, ...legacy, id: "first", name: legacy?.product?.trim() || "项目 1" },
    ]);
    const [projectId, setProjectId] = usePersistedState("wfa_creative_project_id", "first");
    const project = projects.find(item => item.id === projectId) || projects[0];
    const updateProject = change => setProjects(current => current.map(item => item.id === project.id ? change(item) : item));
    const addProject = () => {
        const id = `project-${Date.now().toString(36)}-${projects.length}`;
        setProjects(current => [...current, { ...initialProject, id, name: `项目 ${current.length + 1}` }]);
        setProjectId(id);
        setSuiteTool("shots");
    };
    const [assetId, setAssetId] = useState("");
    const asset = assets.find(item => item.id === assetId);
    const save = item => setAssets(current => [item, ...current]);
    return <div className="wfa-creative">
        <WorkspaceHeader title="创意中心" />
        <div className="wfa-creative-body">
            <div className="wfa-creative-tabs" role="group" aria-label="创意功能">
                {[["storyboard", "套图"], ["pattern", "花型"], ["model", "模特"], ["assets", "素材库"]].map(([id, title]) =>
                    <button key={id} type="button" aria-pressed={page === id} onClick={() => setPage(id)}>{title}</button>)}
            </div>
            {asset && (page === "pattern" || page === "model") && <div className="wfa-creative-reference">
                <span>当前素材 · {asset.name}</span>
                <button type="button" onClick={() => setAssetId("")}>清除</button>
            </div>}
            <div hidden={page !== "storyboard"}>
                <div className="wfa-creative-stack">
                    <section className="wfa-creative-card" aria-label="当前套图项目">
                        <h3>套图项目</h3>
                        <div className="wfa-creative-reference">
                            <select aria-label="切换套图项目" value={project.id} onChange={event => setProjectId(event.target.value)}>
                                {projects.map(item => <option key={item.id} value={item.id}>{item.name || item.product || "未命名项目"}</option>)}
                            </select>
                            <button type="button" onClick={addProject}>新建</button>
                        </div>
                        <label>项目名称<input value={project.name} maxLength={80} onChange={event => {
                            const name = event.target.value;
                            updateProject(current => ({ ...current, name }));
                        }} /></label>
                    </section>
                    <div className="wfa-creative-buttons wfa-creative-suite-tools" role="group" aria-label="套图工具">
                        {[["shots", "套图分镜"], ["reverse", "套图反推"], ["delivery", "审核导出"]].map(([id, title]) =>
                            <button key={id} type="button" aria-pressed={suiteTool === id} onClick={() => setSuiteTool(id)}>{title}</button>)}
                    </div>
                    <div hidden={suiteTool !== "shots"}><Storyboard key={project.id} project={project} onUpdate={updateProject}
                        onSend={onSend} templates={templates} assets={assets} onSaved={save} imageRequestRef={imageRequestRef} /></div>
                    <div hidden={suiteTool !== "reverse"}><SuiteReverse model={visionModel} setModel={setVisionModel} onSave={suite => {
                        setTemplates(current => [...current, { ...suite, id: "suite-" + Date.now().toString(36) + "-" + current.length }]);
                    }} /></div>
                    {suiteTool === "delivery" && <SuiteDelivery key={project.id} project={project} templates={templates} onReject={key => updateProject(current => {
                        const approved = { ...current.approved };
                        delete approved[key];
                        return { ...current, approved };
                    })} />}
                </div>
            </div>
            <div hidden={page !== "pattern"}><PatternStudio asset={asset} onSaved={save} model={visionModel} setModel={setVisionModel} imageRequestRef={imageRequestRef} /></div>
            <div hidden={page !== "model"}><ModelStudio asset={asset} onSaved={save} imageRequestRef={imageRequestRef} /></div>
            <div hidden={page !== "assets"}><CreativeAssetLibrary assets={assets} onSaved={save} onUse={item => {
                setAssetId(item.id);
                setPage(item.type === "model" ? "model" : item.type === "pattern" ? "pattern" : "storyboard");
                if (item.type === "product" || item.type === "suite") {
                    updateProject(current => ({ ...current, referenceId: item.id }));
                    setSuiteTool("shots");
                }
            }} /></div>
        </div>
    </div>;
}

import React, { useEffect, useRef, useState } from "react";
import { isInWebView, photoshop } from "../bridge/uxpBridge.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { getTempResultFolder, saveImageWithBounds } from "../utils/imageSaver.js";
import { safeOpenExternal } from "../utils/safeOpenExternal.js";
import {
    ecomGenOrigin, ecomGenOutputUrl, ecomGenProjectPath,
    listEcomGenProjects, readEcomGenOutputs, uploadPhotoshopToEcomGen,
} from "./ecomGenApi.js";

const tools = [
    ["/suite-forge", "套图工坊"], ["/patterns", "花型工坊"],
    ["/pattern-drafts", "花型起稿"], ["/models", "模特库"],
    ["/library", "资产库"],
];

export function EcomGenWorkspace({ active }) {
    const inPhotoshop = isInWebView();
    const [projects, setProjects] = useState(null);
    const [projectId, setProjectId] = useState("");
    const [outputs, setOutputs] = useState([]);
    const [outputId, setOutputId] = useState("");
    const [kind, setKind] = useState("PRODUCT");
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const lock = useRef(false);
    const connectedOnce = useRef(false);

    async function run(label, action) {
        if (lock.current) return;
        lock.current = true;
        setBusy(label);
        setError("");
        setMessage("");
        try { await action(); }
        catch (failure) { setError(failure?.message || failure?.reason || String(failure)); }
        finally {
            lock.current = false;
            setBusy("");
        }
    }

    async function loadProject(id, currentOutputId) {
        setProjectId(id);
        setOutputs([]);
        setOutputId("");
        if (!id) return;
        const next = await readEcomGenOutputs(id);
        setOutputs(next);
        setOutputId(next.find(output => output.id === currentOutputId)?.id || next[0]?.id || "");
    }

    function refresh() {
        return run("正在同步项目…", async () => {
            let next;
            try { next = await listEcomGenProjects(); }
            catch (failure) {
                setProjects(null);
                setOutputs([]);
                setOutputId("");
                throw failure;
            }
            setProjects(next);
            await loadProject(next.some(project => project.id === projectId) ? projectId : next[0]?.id || "", outputId);
        });
    }

    useEffect(() => {
        if (!active || connectedOnce.current) return;
        connectedOnce.current = true;
        void refresh();
    }, [active]);

    function open(path) {
        const url = ecomGenOrigin + path;
        if (inPhotoshop) {
            void safeOpenExternal(url, { pushStatus: setError });
        } else {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }

    function upload() {
        return run("正在上传 Photoshop 画面…", async () => {
            await uploadPhotoshopToEcomGen(projectId, kind);
            setMessage(kind === "PRODUCT" ? "已上传到项目的商品素材" : "已上传到项目的参考素材");
        });
    }

    function place() {
        return run("正在把成片置入 Photoshop…", async () => {
            const doc = await photoshop.app.getActiveDocument();
            if (doc?.id == null) throw new Error("请先打开要接收成片的 Photoshop 文档");
            const folder = await getTempResultFolder();
            if (!folder?.token) throw new Error("Photoshop 的回图缓存目录不可用");
            const file = await saveImageWithBounds(folder, ecomGenOutputUrl(outputId), 1, {
                docId: doc.id,
                runningHubAppName: "EcomGen",
                fileNameSuffix: outputId,
            });
            if (!file?.fileName) throw new Error("EcomGen 成片下载失败");
            await performAutoPlace([file.fileName], "EcomGen 成片", null, folder.token, doc.id, { force: true, group: false });
            setMessage("成片已置入 Photoshop 独立图层");
        });
    }

    return <div className="wfa-creative-stack">
        <section className="wfa-creative-card" aria-label="EcomGen 工作台">
            <div className="wfa-ecomgen-heading">
                <h3>EcomGen 工作台</h3>
                <small>{busy ? "处理中" : projects === null ? "未连接" : "已连接"}</small>
            </div>
            {projects === null && <p>从 Windows 开始菜单运行「WF美工助手 · 启动 EcomGen」。服务启动后，点击同步。</p>}
            <div className="wfa-ecomgen-primary-row">
                <button type="button" className="wfa-creative-primary" onClick={() => open("/")}>打开工作台 ↗</button>
                <button type="button" disabled={Boolean(busy)} onClick={refresh}>同步</button>
            </div>
            {projects !== null && <details>
                <summary>工坊与素材库</summary>
                <div className="wfa-ecomgen-grid">
                    {tools.map(([path, title]) => <button key={path} type="button" onClick={() => open(path)}>{title} ↗</button>)}
                </div>
            </details>}
        </section>
        {projects !== null && <section className="wfa-creative-card" aria-label="Photoshop 传图">
            <h3>Photoshop 传图</h3>
            {projects.length === 0 ? <p>在工作台创建项目，再回到这里同步。</p> : <>
                <label>项目
                    <select value={projectId} disabled={Boolean(busy)} onChange={event => {
                        const id = event.target.value;
                        void run("正在读取项目成片…", () => loadProject(id));
                    }}>
                        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                </label>
                <button type="button" disabled={!projectId} onClick={() => open(ecomGenProjectPath(projectId))}>打开当前项目 ↗</button>
                {inPhotoshop ? <>
                    <label>上传用途
                        <select value={kind} disabled={Boolean(busy)} onChange={event => setKind(event.target.value)}>
                            <option value="PRODUCT">商品素材</option>
                            <option value="REFERENCE">参考素材</option>
                        </select>
                    </label>
                    <button type="button" disabled={!projectId || Boolean(busy)} onClick={upload}>上传 Photoshop 画面</button>
                    <label>项目成片
                        <select value={outputId} disabled={!outputs.length || Boolean(busy)} onChange={event => setOutputId(event.target.value)}>
                            {!outputs.length && <option value="">{busy ? "请稍候" : "暂无成片"}</option>}
                            {outputs.map((output, index) => <option key={output.id} value={output.id}>
                                {output.title} · {output.width && output.height ? `${output.width} × ${output.height} · ` : ""}{outputs.length - index}
                            </option>)}
                        </select>
                    </label>
                    <button type="button" className="wfa-creative-primary" disabled={!outputId || Boolean(busy)} onClick={place}>置入 Photoshop 图层</button>
                </> : <p>在 Photoshop 插件面板中上传画面或置入成片。</p>}
            </>}
        </section>}
        {(message || busy) && <p className="wfa-ecomgen-message" role="status">{busy || message}</p>}
        {error && <p className="wfa-ecomgen-message" role="alert">{error}</p>}
    </div>;
}

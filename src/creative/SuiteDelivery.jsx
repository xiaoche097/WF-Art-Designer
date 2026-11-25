import React, { useEffect, useState } from "react";
import { invoke, isInWebView } from "../bridge/uxpBridge.js";
import { storage } from "../bridge/uxpShim.js";
import { creativeAssetReference } from "./creativeWorkflows.js";
import { buildStoryboard } from "./storyboard.js";

export function SuiteDelivery({ project, templates, onReject }) {
    const inPhotoshop = isInWebView();
    const storyboard = buildStoryboard(project, templates.find(template => template.id === project.suiteId));
    const approved = storyboard.flatMap(shot => {
        const key = `${project.suiteId}:${shot.id}`;
        const image = project.approved?.[key];
        return image ? [{ ...image, id: shot.id, key, title: shot.title }] : [];
    });
    const [selection, setSelection] = useState("");
    const active = approved.find(shot => shot.key === selection) || approved[0];
    const activeId = active?.fileName;
    const [preview, setPreview] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        let alive = true;
        setPreview("");
        if (activeId && inPhotoshop) {
            creativeAssetReference({ fileName: activeId }).then(
                image => { if (alive) setPreview(image.url); },
                failure => { if (alive) setError(failure.message || "成片无法读取"); }
            );
        }
        return () => { alive = false; };
    }, [activeId, inPhotoshop]);

    async function exportSuite() {
        if (exporting || !approved.length) return;
        setExporting(true);
        setStatus("");
        setError("");
        try {
            const folder = await storage.localFileSystem.getFolder();
            if (!folder) return;
            const { fileName, count } = await invoke("creative.exportSuite", folder.token, {
                project: {
                    name: project.name,
                    product: project.product,
                    facts: project.facts,
                    market: project.market,
                    language: project.language,
                    artDirection: project.artDirection,
                },
                shots: approved,
            });
            setStatus(`已导出 ${count} 张 · ${fileName}`);
        } catch (failure) { setError(failure.message || "套图打包失败"); }
        finally { setExporting(false); }
    }

    return <section className="wfa-creative-card" aria-label="审核与导出">
        <h3>审核与导出</h3>
        <p>已通过 {approved.length} / {storyboard.length} 张。确认成片后，在对应分镜点「通过审核」。</p>
        {active && <>
            <label>已通过成片<select value={active.key} disabled={exporting} onChange={event => {
                setError("");
                setSelection(event.target.value);
            }}>{approved.map(shot => <option key={shot.key} value={shot.key}>{shot.title}</option>)}</select></label>
            {preview && <img className="wfa-creative-result" src={preview} alt={active.title} />}
            <button type="button" disabled={exporting} onClick={() => onReject(active.key)}>取消通过</button>
            <button type="button" className="wfa-creative-primary" disabled={exporting || !inPhotoshop} onClick={exportSuite}>
                {exporting ? "正在打包…" : `导出已通过成片 ZIP（${approved.length}）`}
            </button>
        </>}
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

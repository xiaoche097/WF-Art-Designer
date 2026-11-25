import React, { useRef, useState } from "react";
import { invoke, isInWebView } from "../bridge/uxpBridge.js";
import { WorkspaceHeader } from "../components/WorkspaceHeader.jsx";
import { PS_SCRIPTS } from "./catalog.js";
import "./PsTools.css";

export function PsTools() {
    const connected = isInWebView();
    const lock = useRef(false);
    const [runningId, setRunningId] = useState(null);
    const [status, setStatus] = useState(null);

    async function run(script) {
        if (!connected || lock.current) return;
        lock.current = true;
        setRunningId(script.id);
        setStatus(null);
        try {
            const result = await invoke("psScripts.run", { id: script.id });
            setStatus({ text: result.cancelled ? `已取消「${script.name}」。` : `「${script.name}」已结束。` });
        } catch (error) {
            setStatus({ text: error.message || String(error), error: true });
        } finally {
            lock.current = false;
            setRunningId(null);
        }
    }

    return <div className="wfa-ps-tools">
        <WorkspaceHeader title="PS 工具" />
        <section className="wfa-ps-tools-card" aria-labelledby="wfa-ps-scripts-title">
            <div className="wfa-ps-tools-heading">
                <h3 id="wfa-ps-scripts-title">脚本</h3>
                <p>{connected ? "先在图层面板选中要处理的组。" : "请在 Photoshop 中打开 WF美工助手来运行脚本。"}</p>
            </div>
            <ul className="wfa-ps-tools-list">
                {PS_SCRIPTS.map(script => <li key={script.id}>
                    <div>
                        <h4>{script.name}</h4>
                        <p>{script.description}</p>
                    </div>
                    <button type="button" aria-label={`运行 ${script.name}`} disabled={!connected || Boolean(runningId)}
                        onClick={() => run(script)}>
                        {runningId === script.id ? "运行中" : "运行"}
                    </button>
                </li>)}
            </ul>
            <p className="wfa-ps-tools-status" role="status" data-error={status?.error || undefined}
                hidden={!status && !runningId}>
                {runningId ? "脚本正在 Photoshop 中运行。" : status?.text}
            </p>
        </section>
    </div>;
}

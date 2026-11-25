import React, { useEffect, useRef, useState } from "react";
import { isInWebView, photoshop } from "../bridge/uxpBridge.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { saveImageWithBounds } from "../utils/imageSaver.js";
import { creativeAssetFolder, creativeAssetReference, prepareCreativeImage } from "./creativeWorkflows.js";

const types = { suite: "套图", pattern: "花型", model: "模特", product: "商品" };

export function CreativeAssetLibrary({ assets, onSaved, onUse }) {
    const inPhotoshop = isInWebView();
    const [filter, setFilter] = useState("");
    const [importType, setImportType] = useState("product");
    const [selectedId, setSelectedId] = useState("");
    const [preview, setPreview] = useState("");
    const [busy, setBusy] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const lock = useRef(false);
    const visible = assets.filter(item => !filter || item.type === filter);
    const selected = visible.find(item => item.id === selectedId) || visible[0];

    useEffect(() => {
        let current = true;
        setPreview("");
        if (selected && inPhotoshop) {
            creativeAssetReference(selected).then(image => {
                if (current) setPreview(image.url);
            }, failure => {
                if (current) setError(failure.message || "素材文件读取失败");
            });
        }
        return () => { current = false; };
    }, [selected, inPhotoshop]);

    async function run(label, operation) {
        if (lock.current) return;
        lock.current = true;
        setBusy(label);
        setError("");
        setStatus("");
        try { await operation(); }
        catch (failure) { setError(failure?.message || failure?.reason || String(failure)); }
        finally { lock.current = false; setBusy(""); }
    }

    function add(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        void run("正在导入素材…", async () => {
            const image = await prepareCreativeImage(file, 1600);
            const folder = await creativeAssetFolder();
            const saved = await saveImageWithBounds(folder, image.url, 1, { runningHubAppName: "创意素材" });
            onSaved({ id: saved.fileName, fileName: saved.fileName, type: importType, name: file.name.slice(0, 120) });
            setFilter("");
            setSelectedId(saved.fileName);
            setStatus("素材已保存。");
        });
    }

    function place() {
        return run("正在置入 Photoshop…", async () => {
            const doc = await photoshop.app.getActiveDocument();
            if (doc?.id == null) throw new Error("请先打开要接收素材的 Photoshop 文档");
            const folder = await creativeAssetFolder();
            await performAutoPlace([selected.fileName], "创意中心", null, folder.token, doc.id, { force: true, group: false });
            setStatus("素材已置入独立图层。");
        });
    }

    return <section className="wfa-creative-card" aria-label="素材库">
        <h3>素材库</h3>
        {!inPhotoshop && <p>此处的素材保存在 Photoshop 插件的数据目录中。</p>}
        {inPhotoshop && <details>
            <summary>导入素材</summary>
            <label>素材分类<select value={importType} disabled={Boolean(busy)} onChange={event => setImportType(event.target.value)}>
                {Object.entries(types).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={add} /></label>
        </details>}
        <label>筛选分类<select value={filter} disabled={Boolean(busy)} onChange={event => {
            setFilter(event.target.value);
            setError("");
        }}>
            <option value="">全部素材</option>
            {Object.entries(types).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        {selected && <label>选择素材
            <select value={selected.id} disabled={Boolean(busy)} onChange={event => { setSelectedId(event.target.value); setError(""); }}>
                {visible.map(item => <option key={item.id} value={item.id}>{types[item.type]} · {item.name}</option>)}
            </select>
        </label>}
        {preview && <img className="wfa-creative-result" src={preview} alt={selected?.name || "素材预览"} />}
        {selected && inPhotoshop && <div className="wfa-creative-buttons">
            <button type="button" className="wfa-creative-primary" disabled={!preview || Boolean(busy)} onClick={() => onUse(selected)}>作为参考图</button>
            <button type="button" disabled={!preview || Boolean(busy)} onClick={place}>置入 Photoshop</button>
        </div>}
        {!selected && <p>当前分类暂无素材。</p>}
        {(busy || status) && <p role="status">{busy || status}</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

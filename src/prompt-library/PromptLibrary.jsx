import React, { useState } from "react";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { libraryCatalog } from "./catalog.js";
import "./PromptLibrary.css";

const types = [["prompt", "提示词库"], ["style", "风格库"]];

export function PromptLibrary({ onUse, existingPresets }) {
    const [kind, setKind] = useState("prompt");
    const [query, setQuery] = useState("");
    const [stored, setStored] = usePersistedState("wfa_prompt_library_v1", []);
    const [editor, setEditor] = useState(null);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [notice, setNotice] = useState("");
    const personal = Array.isArray(stored) ? stored : [];
    const presets = kind === "prompt" ? existingPresets.map(item => ({
        id: "preset-" + item.id, name: item.name, text: item.prompt, tag: "织影预设",
    })) : [];
    const seen = new Set();
    const all = [
        ...personal.filter(item => item.kind === kind).map(item => ({ ...item, own: true, tag: "我的收藏" })),
        ...libraryCatalog[kind], ...presets,
    ].filter(item => {
        const key = item.text.trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const keyword = query.trim().toLocaleLowerCase();
    const visible = all.filter(item => [item.name, item.tag, item.text].some(value =>
        value.toLocaleLowerCase().includes(keyword)));

    function save(event) {
        event.preventDefault();
        const name = editor.name.trim();
        const text = editor.text.trim();
        if (!name || !text) return;
        const entry = { id: editor.id || `library-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, name, text };
        setStored(value => [entry, ...(Array.isArray(value) ? value.filter(item => item.id !== entry.id) : [])]);
        setEditor(null);
        setQuery("");
        setNotice("已保存到我的收藏");
    }

    return <section className="wfa-prompt-library" aria-label="提示词与风格">
        <div className="wfa-library-toolbar">
            <div className="wfa-library-tabs" role="group" aria-label="库类型">
                {types.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id}
                    onClick={() => { setKind(id); setQuery(""); setEditor(null); setPendingDelete(null); setNotice(""); }}>
                    {label}
                </button>)}
            </div>
            <button type="button" className="wfa-library-add" onClick={() => {
                setEditor({ name: "", text: "" }); setNotice("");
            }}>{kind === "prompt" ? "新增提示词" : "新增风格"}</button>
        </div>
        <input className="wfa-library-search" type="search" value={query} aria-label="搜索提示词和风格"
            placeholder={kind === "prompt" ? "搜索提示词" : "搜索风格"} onChange={event => setQuery(event.target.value)} />
        <details className="wfa-library-guide">
            <summary>Skills Wiki · 提示词用法</summary>
            <ul>
                <li>先确定任务与交付画面，例如白底主图、SKU 换色或材质特写。</li>
                <li>编辑参考图时，写清修改范围及要保留的文字、纹理和背景。</li>
                <li>再选一个风格，补充光线、色调或构图。效果合适时可保存到收藏。</li>
            </ul>
        </details>
        {editor && <form className="wfa-library-card wfa-library-form" onSubmit={save}>
            <label>名称<input required maxLength={60} value={editor.name}
                onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>内容<textarea required rows={4} maxLength={8000} value={editor.text}
                onChange={event => setEditor({ ...editor, text: event.target.value })} /></label>
            <div className="wfa-library-actions">
                <button type="button" onClick={() => setEditor(null)}>取消</button>
                <button className="wfa-library-use" type="submit" disabled={!editor.name.trim() || !editor.text.trim()}>保存</button>
            </div>
        </form>}
        {notice && <p role="status" className="wfa-library-note">{notice}</p>}
        <div className="wfa-library-list">
            {visible.map(item => <article key={(item.own ? "own-" : "") + item.id} className="wfa-library-card">
                <header>
                    <div><h2>{item.name}</h2><span className="wfa-library-note">{item.tag}</span></div>
                    <button type="button" className="wfa-library-use" aria-label={`使用 ${item.name}`}
                        onClick={() => onUse(item.text)}>使用</button>
                </header>
                <p>{item.text}</p>
                {item.own && <div className="wfa-library-actions">
                    <button type="button" onClick={() => { setEditor(item); setPendingDelete(null); }}>编辑</button>
                    {pendingDelete === item.id ? <>
                        <button type="button" onClick={() => setPendingDelete(null)}>取消删除</button>
                        <button type="button" onClick={() => {
                            setStored(items => items.filter(entry => entry.id !== item.id));
                            if (editor?.id === item.id) setEditor(null);
                            setPendingDelete(null);
                            setNotice("已删除收藏");
                        }}>确认删除</button>
                    </> : <button type="button" onClick={() => setPendingDelete(item.id)}>删除</button>}
                </div>}
            </article>)}
            {!visible.length && <p className="wfa-library-note" role="status">没有找到匹配的条目。</p>}
        </div>
    </section>;
}

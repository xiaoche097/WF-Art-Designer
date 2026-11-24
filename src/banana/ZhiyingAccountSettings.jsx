import React, { useState } from "react";
import { RhSecureKeyField } from "../runninghub/ui/RhApiKeySettingsBlock.jsx";
import { GEMINI_IMAGES, OPENAI_IMAGES } from "./bananaApi.js";

export const ZHIYING = "zhiying";
export const CUSTOM = "custom";
export const EMPTY_PROFILE = Object.freeze({ name: "", baseUrl: "", apiKey: "", protocol: GEMINI_IMAGES, model: "" });

const VISIBLE_MODEL_LIMIT = 60;

function ModelPicker({ value, result, rejected, onSelect, onRefresh }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const models = result?.models || [];
    const pending = result?.pending === true;
    const filtered = models.filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()));
    const selected = rejected ? "" : value;

    const refresh = () => {
        setQuery("");
        setOpen(true);
        void onRefresh();
    };

    const choose = (model) => {
        onSelect(model);
        setOpen(false);
        document.getElementById("zhiying-model-trigger")?.focus();
    };

    return (
        <section className="zhiying-model-picker" aria-labelledby="zhiying-model-label">
            <span id="zhiying-model-label" className="banana-provider-field">模型</span>
            <div className="zhiying-model-actions">
                <button type="button" id="zhiying-model-trigger" className="zhiying-model-current"
                    aria-label={selected ? `选择图像模型，当前 ${selected}` : "选择图像模型"} title={selected || undefined}
                    aria-expanded={open} aria-controls="zhiying-model-results" onClick={() => setOpen(!open)}>
                    {selected || "选择图像模型"}
                </button>
                <button type="button" className="zhiying-fetch-models" disabled={pending}
                    aria-controls="zhiying-model-results" onClick={refresh}>
                    {pending ? "拉取中…" : "拉取模型"}
                </button>
            </div>
            <div id="zhiying-model-results" hidden={!open} className="zhiying-model-results"
                aria-busy={pending}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    setOpen(false);
                    document.getElementById("zhiying-model-trigger")?.focus();
                }}>
                {pending && <p className="zhiying-model-note" role="status">正在向供应商请求模型…</p>}
                {result?.error && <p className="zhiying-model-error" role="alert">{result.error}</p>}
                {!result && <p className="zhiying-model-note">点击「拉取模型」读取供应商的模型列表。</p>}
                {result && !pending && !result.error && (
                    <p className="zhiying-model-note" role="status">{models.length ? `找到 ${models.length} 个图像模型` : "未识别到图像模型"}</p>
                )}
                {models.length > 0 && (
                    <>
                        <input type="search" className="zhiying-model-search" aria-label="搜索模型"
                            placeholder="搜索模型 ID" value={query} onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && filtered.length === 1) choose(filtered[0]);
                            }} />
                        {filtered.length ? (
                            <ul className="zhiying-model-list" aria-label="可选模型">
                                {filtered.slice(0, VISIBLE_MODEL_LIMIT).map((model) => (
                                    <li key={model}>
                                        <button type="button" title={model} aria-pressed={model === selected} onClick={() => choose(model)}>
                                            {model}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="zhiying-model-note">没有匹配的模型。</p>}
                        {filtered.length > VISIBLE_MODEL_LIMIT && <p className="zhiying-model-note">继续搜索以缩小结果范围。</p>}
                    </>
                )}
            </div>
            {rejected && <p className="zhiying-model-error" role="status">当前 ID 未识别为图像生成或编辑模型，请重新选择。</p>}
            <details className="zhiying-manual-model">
                <summary>手动填写模型 ID</summary>
                <label className="banana-provider-field">模型 ID
                    <input value={value} onChange={(event) => onSelect(event.target.value)} placeholder="填写供应商提供的模型 ID" />
                </label>
            </details>
        </section>
    );
}

export function ZhiyingAccountSettings({ provider, profile, profiles, onSelect, onAdd, onChange, onRefresh, modelResult, modelRejected }) {
    const builtIn = provider === ZHIYING;
    const field = (name) => (event) => onChange(name, event.target.value);

    return (
        <div className="rh-config-content banana-account-stack">
            <span className="rh-config-label">供应商</span>
            <div className="rh-key-mode-switch" role="group" aria-label="织影供应商">
                <button type="button" className={`rh-key-mode-btn ${builtIn ? "is-active" : ""}`} aria-pressed={builtIn} onClick={() => onSelect(ZHIYING)}>织影</button>
                <button type="button" className={`rh-key-mode-btn ${!builtIn ? "is-active" : ""}`} aria-pressed={!builtIn} onClick={() => builtIn && onSelect(profiles[0]?.id || CUSTOM)}>自定义</button>
            </div>
            {!builtIn && (
                <div className="banana-provider-list">
                    <label className="banana-provider-field">自定义供应商
                        <select value={provider} onChange={(event) => onSelect(event.target.value)}>
                            {provider === CUSTOM && <option value={CUSTOM}>请选择或添加供应商</option>}
                            {profiles.map((item) => <option key={item.id} value={item.id}>{item.name.trim() || "未命名供应商"}</option>)}
                        </select>
                    </label>
                    <button type="button" className="rh-key-field-link-btn" onClick={onAdd}>添加供应商</button>
                </div>
            )}
            {provider !== CUSTOM && (
                <div className="rh-key-field-card banana-key-card is-active banana-provider-fields">
                    {!builtIn && <label className="banana-provider-field">供应商名称<input value={profile.name} onChange={field("name")} placeholder="输入供应商名称" /></label>}
                    <label className="banana-provider-field">API Base URL<input type="url" value={profile.baseUrl} onChange={field("baseUrl")} placeholder="https://api.example.com" /></label>
                    <div className="banana-provider-field">
                        <span id="zhiying-protocol-label">接口格式</span>
                        <div className="zhiying-segments" role="group" aria-labelledby="zhiying-protocol-label">
                            {[[GEMINI_IMAGES, "Gemini 兼容"], [OPENAI_IMAGES, "OpenAI Images 兼容"]].map(([id, label]) => (
                                <button type="button" key={id} aria-pressed={profile.protocol === id}
                                    onClick={() => onChange("protocol", id)}>{label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="banana-provider-field">
                        <span>API Key</span>
                        <RhSecureKeyField value={profile.apiKey} inputLabel="API Key" onValueChange={(value) => onChange("apiKey", value)} placeholder="填写当前供应商的 API Key" />
                    </div>
                    <ModelPicker key={provider} value={profile.model} result={modelResult} rejected={modelRejected}
                        onSelect={(model) => onChange("model", model)} onRefresh={onRefresh} />
                </div>
            )}
        </div>
    );
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WorkspaceHeader } from "../components/WorkspaceHeader.jsx";
import { WorkspaceSectionHeader } from "../components/shared/WorkspaceSectionHeader.jsx";
import { createPortal } from "react-dom";
import { core, app } from "photoshop";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { isInWebView, photoshop, wfArtAssistantPeekUploadSessionRawBase64, wfArtAssistantReleaseUploadSession } from "../bridge/uxpBridge.js";
import { captureAll, computeRhPlaceContextBoundsSync } from "../components/ImageUpload/captureUtils.js";
import { useSquareSelectionWarning } from "../components/ImageUpload/SquareSelectionWarning.jsx";
import { CustomSelect } from "../components/CustomSelect.jsx";
import { TaskPreviewThumb } from "../components/shared/TaskPreviewLightbox.jsx";
import { SettingsCard } from "../components/settings/SettingsCard.jsx";
import { RhImagePreviewField } from "../runninghub/ui/RhImagePreviewField.jsx";
import { normalizeRhImageLongEdgeMax } from "../runninghub/rhImageLongEdge.js";
import { RH_PS_CAPTURE_JPEG_QUALITY, base64ByteLength, normalizeRhUploadImageFormat, rhCaptureFileName, stripBase64FromDataUrl } from "../runninghub/ui/wfaRhWorkPanelLogic.js";
import { RESULT_WORKBENCH_BANANA, getEffectiveResultFolderToken } from "../utils/resultFolderTokens.js";
import { getTempResultFolder, saveImageWithBounds } from "../utils/imageSaver.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { notifyResultFilesChanged } from "../utils/resultFilesSync.js";
import { playSound, playSoundFail } from "../utils/playSound.js";
import {
    readAutoReturnEnabled,
    readConcurrentReturnGroupEnabled,
    readFailSoundFile,
    readSuccessSoundFile,
} from "../utils/sharedInteractionSettings.js";
import { readCompatLocalStorage, removeCompatLocalStorage } from "../utils/storageKeyCompat.js";
import { pruneCompletedRhRuns } from "../runninghub/hooks/wfaRunQueueRecords.js";
import { ComfySettings } from "../comfy/ComfyShell.jsx";
import { OPENAI_IMAGES, fetchBananaModels, resolveBananaRunConfig, runBananaImage } from "./bananaApi.js";
import { resolveModelImageSelection } from "./imageModelOptions.js";
import { imageModelKind } from "./imageModelFilter.js";
import { CUSTOM, EMPTY_PROFILE, ZHIYING, ZhiyingAccountSettings } from "./ZhiyingAccountSettings.jsx";
import { DEFAULT_BANANA_PROMPT_PRESET_FILES } from "./defaultBananaPromptPresetBundle.js";
import "../components/WorkPanel/WorkPanel.css";
import "../components/ImageUpload/ImageUpload.css";
import "../runninghub/ui/RhWorkPanel.css";
import "../comfy/ComfyShell.css";
import "./BananaShell.css";

const uxpStorage = require("uxp").storage;
const uxpFs = uxpStorage.localFileSystem;
const uxpFormats = uxpStorage.formats;
const BANANA_PRESET_FOLDER = "banana_presets";
const BANANA_PROMPT_PRESET_STORAGE_KEY = "banana_prompt_presets";
const BANANA_PRESET_MIGRATION_KEY = "banana_prompt_presets_migrated_to_data_folder_v1";
const BANANA_DEFAULT_PRESETS_APPLIED_KEY = "banana_prompt_default_presets_applied_v1";
const BANANA_PARAM_MENU_Z_INDEX = 100020;
const BANANA_PROMPT_MENU_Z_INDEX = 100030;
const BANANA_PROMPT_HISTORY_LIMIT = 50;
const BANANA_MAIN_IMAGE_SLOT = "main";
const BANANA_REF_IMAGE_SLOTS = Object.freeze([
    { key: "image2", label: "图二" },
    { key: "image3", label: "图三" },
    { key: "image4", label: "图四" },
]);

const IconRefresh = ({ className = "" }) => (
    <svg className={className} width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

const IconSettings = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const IconBack = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
);

const IconHelp = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 1 1 4.9 2.3c-.9.7-1.5 1.2-1.5 2.2" />
        <path d="M12 17h.01" />
    </svg>
);

const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

function normalizePlaceContext(value) {
    const bounds = value?.bounds;
    return bounds && value?.docId != null && ["left", "top", "right", "bottom"].every((key) => Number.isFinite(bounds[key])) ? { docId: value.docId, bounds } : null;
}

async function captureBananaImage(longEdgeMax, uploadImageFormat) {
    const options = {
        longEdgeMax: normalizeRhImageLongEdgeMax(longEdgeMax),
        uploadEncodeFormat: normalizeRhUploadImageFormat(uploadImageFormat),
        jpegQuality: RH_PS_CAPTURE_JPEG_QUALITY,
        requireSelection: true,
        hostPreviewFromUpload: true,
    };
    if (isInWebView()) return captureAll("canvas", { ...options, __retainUploadSession: true });
    let capture;
    await core.executeAsModal(async (context) => {
        const docId = app.activeDocument?.id;
        if (!docId) throw new Error("请先打开 Photoshop 文档");
        const historyId = await context.hostControl.suspendHistory({ documentID: docId, name: "织影捕获" });
        try { capture = await captureAll("canvas", options); }
        finally { await context.hostControl.resumeHistory(historyId); }
    }, { commandName: "织影捕获" });
    return capture;
}

async function recordPlaceContext() {
    if (isInWebView()) {
        try { return normalizePlaceContext(await photoshop.commands.recordRhRunPlaceContext("canvas")); }
        catch (_) { return null; }
    }
    const box = { value: null };
    try {
        await core.executeAsModal(async () => { box.value = computeRhPlaceContextBoundsSync("canvas"); }, { commandName: "织影记录回图选区" });
    } catch (_) {}
    return normalizePlaceContext(box.value);
}

function uploadFromCapture(capture, previous) {
    const base64 = stripBase64FromDataUrl(capture?.uploadBase64 || "");
    const uploadSessionId = String(capture?.uploadSessionId || "").trim();
    if (!base64 && !uploadSessionId) return null;
    const mimeType = capture.mimeType || previous?.mimeType || "image/png";
    const bounds = capture?.bounds;
    const aspectRatio = bounds && bounds.right > bounds.left && bounds.bottom > bounds.top ? (bounds.right - bounds.left) / (bounds.bottom - bounds.top) : previous?.aspectRatio;
    return {
        fileName: rhCaptureFileName("banana", mimeType),
        mimeType,
        base64,
        uploadSessionId,
        previewBase64: capture.previewBase64 || previous?.previewBase64 || "",
        uploadByteLength: capture.uploadByteLength || base64ByteLength(base64),
        uploadWidth: capture.uploadWidth,
        uploadHeight: capture.uploadHeight,
        aspectRatio,
        docId: capture?.docId ?? previous?.docId ?? null,
        bounds: capture?.bounds ?? previous?.bounds ?? null,
    };
}

async function materializeUploadRecord(uploadRecord) {
    if (!uploadRecord?.uploadSessionId) return uploadRecord;
    try {
        const res = await wfArtAssistantPeekUploadSessionRawBase64(uploadRecord.uploadSessionId);
        if (!res?.ok || !res.rawBase64) throw new Error(res?.message || "读取图片会话失败");
        const base64 = String(res.rawBase64 || "");
        return {
            ...uploadRecord,
            base64,
            uploadSessionId: "",
            uploadByteLength: uploadRecord.uploadByteLength || base64ByteLength(base64),
        };
    } finally {
        await wfArtAssistantReleaseUploadSession(uploadRecord.uploadSessionId).catch(() => {});
    }
}

function releaseUploadRecord(uploadRecord) {
    const sessionId = String(uploadRecord?.uploadSessionId || "").trim();
    if (sessionId) wfArtAssistantReleaseUploadSession(sessionId).catch(() => {});
}

function hasBananaUpload(uploadRecord) {
    return !!(uploadRecord?.base64 || uploadRecord?.uploadSessionId || uploadRecord?.previewBase64 || uploadRecord?.fileName);
}

function bananaSlotLabel(slotKey) {
    if (slotKey === BANANA_MAIN_IMAGE_SLOT) return "图一";
    return BANANA_REF_IMAGE_SLOTS.find((slot) => slot.key === slotKey)?.label || "图像";
}

function bananaImageEntries(mainUpload, refUploads, multiImageMode) {
    const entries = [{ key: BANANA_MAIN_IMAGE_SLOT, record: mainUpload }].filter((entry) => hasBananaUpload(entry.record));
    if (!multiImageMode) return entries;
    for (const slot of BANANA_REF_IMAGE_SLOTS) {
        const record = refUploads?.[slot.key];
        if (hasBananaUpload(record)) entries.push({ key: slot.key, record });
    }
    return entries;
}

function bananaPromptWithImageLabels(prompt, entries, multiImageMode) {
    const text = String(prompt || "");
    if (!multiImageMode || !entries?.length) return text;
    const labels = entries.map((entry, index) => `第${index + 1}张图片是${bananaSlotLabel(entry.key)}`).join("；");
    return `${text.trim()}\n\n图片顺序说明：${labels}。用户提到图一、图二、图三、图四时，按上述对应关系理解。`.trim();
}

function formatRunStatus(run) {
    if (run.status === "success") return run.failedCount ? `完成 ${run.doneCount}/${run.total}，失败 ${run.failedCount}` : "已完成";
    if (run.status === "cancelled") return "已取消";
    if (run.status === "error") return "失败";
    return "运行中";
}

function elapsedSeconds(startTime) {
    return startTime ? (Date.now() - startTime) / 1000 : 0;
}

function batchProgressText(run) {
    const total = Number(run?.batchImageTotal || run?.batchTotal || 0);
    return total > 1 ? `返回 ${Number(run?.batchDone || 0)} 张/共 ${total} 张` : "";
}

function safeBananaPresetFileName(value) {
    return (String(value || "").trim() || "preset").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 48);
}

function normalizeBananaPreset(value, fileName) {
    if (!value || typeof value !== "object") return null;
    const name = String(value.name || value.title || "").trim();
    const prompt = String(value.prompt || value.content || "").trim();
    if (!name || !prompt) return null;
    const id = String(value.id || "").trim() || `banana_prompt_${safeBananaPresetFileName(fileName).replace(/\.json$/i, "")}`;
    return { id, name, prompt, updatedAt: Number(value.updatedAt || 0), fileName };
}

function normalizePromptHistory(list) {
    return (Array.isArray(list) ? list : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, BANANA_PROMPT_HISTORY_LIMIT);
}

function addPromptHistoryItem(list, prompt) {
    const text = String(prompt || "").trim();
    if (!text) return normalizePromptHistory(list);
    return [text, ...normalizePromptHistory(list).filter((item) => item !== text)].slice(0, BANANA_PROMPT_HISTORY_LIMIT);
}

function promptHistoryLabel(prompt) {
    const text = String(prompt || "").replace(/\s+/g, " ").trim();
    return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

async function getBananaPresetFolder() {
    const dataFolder = await uxpFs.getDataFolder();
    try {
        const existing = await dataFolder.getEntry(BANANA_PRESET_FOLDER);
        if (existing?.isFile === false) return existing;
    } catch (_) {}
    return dataFolder.createFolder(BANANA_PRESET_FOLDER);
}

function hasMigratedBananaPromptPresets() {
    try {
        return localStorage.getItem(BANANA_PRESET_MIGRATION_KEY) === "1";
    } catch (_) {
        return false;
    }
}

function markBananaPromptPresetsMigrated() {
    try {
        localStorage.setItem(BANANA_PRESET_MIGRATION_KEY, "1");
    } catch (_) {}
}

function hasAppliedBananaDefaultPresets() {
    try {
        return localStorage.getItem(BANANA_DEFAULT_PRESETS_APPLIED_KEY) === "1";
    } catch (_) {
        return false;
    }
}

function markBananaDefaultPresetsApplied() {
    try {
        localStorage.setItem(BANANA_DEFAULT_PRESETS_APPLIED_KEY, "1");
    } catch (_) {}
}

async function restoreMissingBananaDefaultPresets(targetFolder) {
    const folder = targetFolder || await getBananaPresetFolder();
    const entries = await folder.getEntries();
    const existing = new Set((entries || []).filter((entry) => entry?.isFile !== false).map((entry) => String(entry.name || "")));
    let restored = 0;

    for (const item of DEFAULT_BANANA_PROMPT_PRESET_FILES) {
        const fileName = String(item?.fileName || "").trim();
        if (!fileName || existing.has(fileName)) continue;
        const preset = normalizeBananaPreset(item.preset, fileName);
        if (!preset) continue;
        const file = await folder.createFile(fileName, { overwrite: false });
        await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
        existing.add(fileName);
        restored += 1;
    }

    return restored;
}

async function ensureBananaDefaultPromptPresets(folder) {
    const restored = await restoreMissingBananaDefaultPresets(folder);
    markBananaDefaultPresetsApplied();
    return restored;
}

async function migrateBananaPromptPresets(folder) {
    if (hasMigratedBananaPromptPresets()) return 0;
    let migrated = 0;
    try {
        const raw = readCompatLocalStorage(BANANA_PROMPT_PRESET_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            const existing = new Set(((await folder.getEntries()) || []).map((entry) => String(entry?.name || "")));
            for (const item of list) {
                const preset = normalizeBananaPreset(item, "");
                if (!preset) continue;
                const fileName = `${safeBananaPresetFileName(preset.name || preset.id)}.json`;
                if (existing.has(fileName)) continue;
                const file = await folder.createFile(fileName, { overwrite: false });
                await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
                existing.add(fileName);
                migrated += 1;
            }
        }
    } catch (_) {}
    markBananaPromptPresetsMigrated();
    return migrated;
}

async function loadBananaPromptPresets() {
    const folder = await getBananaPresetFolder();
    await ensureBananaDefaultPromptPresets(folder);
    await migrateBananaPromptPresets(folder);
    const entries = (await folder.getEntries()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"));
    const out = [];
    for (const entry of entries || []) {
        if (entry?.isFile === false || !/\.json$/i.test(entry?.name || "")) continue;
        try {
            const preset = normalizeBananaPreset(JSON.parse(await entry.read({ format: uxpFormats.utf8 })), entry.name);
            if (preset) out.push(preset);
        } catch (_) {}
    }
    return out.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function saveBananaPromptPresetFile(preset) {
    const folder = await getBananaPresetFolder();
    const file = await folder.createFile(`${safeBananaPresetFileName(preset.name || preset.id)}.json`, { overwrite: true });
    await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
}

async function deleteBananaPromptPresetFile(preset) {
    const folder = await getBananaPresetFolder();
    const fileName = preset?.fileName || `${safeBananaPresetFileName(preset?.name || preset?.id)}.json`;
    const file = await folder.getEntry(fileName);
    if (file?.isFile !== false) await file.delete();
}

function BananaLatencyToast({ result }) {
    if (!result) return null;
    const label = result.latencyMs != null ? `${Math.max(0, Math.round(result.latencyMs))}ms` : "失败";
    return <div key={result.id} className={`banana-latency-toast ${result.ok ? "is-ok" : "is-bad"}`} title={result.label || ""}>{label}</div>;
}

function Stepper({ label, value, min, max, onChange, suffix = "" }) {
    const next = (delta) => onChange(Math.max(min, Math.min(max, Number(value || min) + delta)));
    return (
        <div className="banana-stepper">
            <span className="banana-stepper-label">{label}</span>
            <div className="banana-stepper-control">
                <button type="button" onClick={() => next(-1)} disabled={value <= min} title={`减少${label}`}>−</button>
                <span>{value}{suffix}</span>
                <button type="button" onClick={() => next(1)} disabled={value >= max} title={`增加${label}`}>+</button>
            </div>
        </div>
    );
}

function bananaParamMenuStyle(anchor) {
    if (!anchor || typeof window === "undefined") return null;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin));
    const maxHeight = Math.max(140, Math.min(292, window.innerHeight - rect.bottom - margin));
    return {
        position: "fixed",
        left,
        top: rect.bottom + 2,
        width: rect.width,
        maxHeight,
        zIndex: BANANA_PARAM_MENU_Z_INDEX,
    };
}

function bananaPromptMenuStyle(anchor) {
    if (!anchor || typeof window === "undefined") return null;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = Math.min(360, Math.max(260, rect.width + 288));
    const below = window.innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const openUp = below < 170 && above > below;
    const style = {
        position: "fixed",
        right: Math.max(margin, window.innerWidth - rect.right),
        width: Math.min(width, window.innerWidth - margin * 2),
        maxHeight: Math.max(150, Math.min(310, openUp ? above : below)),
        zIndex: BANANA_PROMPT_MENU_Z_INDEX,
    };
    if (openUp) style.bottom = Math.max(margin, window.innerHeight - rect.top + gap);
    else style.top = rect.bottom + gap;
    return style;
}

function bananaPromptPresetButtonStyle(anchor) {
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    return {
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: BANANA_PROMPT_MENU_Z_INDEX,
    };
}

function BananaTopBar({ supplier, loading, onRefresh, isSettingsOpen, onToggleView }) {
    const [helpOpen, setHelpOpen] = useState(false);
    return (
        <>
            <WorkspaceHeader title={isSettingsOpen ? "织影设置" : "织影"} detail={`供应商 · ${supplier}`}
                actions={<>
                    <button type="button" className="icon-btn" onClick={onRefresh} title="连接并刷新模型" aria-label="连接并刷新模型"><IconRefresh className={loading ? "rh-spinning" : ""} /></button>
                    <button type="button" className="icon-btn rh-help-btn" onClick={() => setHelpOpen(true)} title="使用说明" aria-label="使用说明"><IconHelp /></button>
                    <button type="button" className="icon-btn" onClick={onToggleView} title={isSettingsOpen ? "返回主页" : "打开设置"} aria-label={isSettingsOpen ? "返回主页" : "打开设置"}>{isSettingsOpen ? <IconBack /> : <IconSettings />}</button>
                </>}
            />
            {helpOpen && <div className="xl-popup-overlay" onClick={() => setHelpOpen(false)}><div className="xl-popup-dialog rh-help-dialog" role="dialog" aria-modal="true" aria-label="织影使用说明" onClick={(event) => event.stopPropagation()}>
                <div className="xl-popup-icon rh-help-icon">?</div>
                <div className="xl-popup-title">织影使用说明</div>
                <div className="xl-popup-body rh-help-body"><p>插件可在 Photoshop 内快捷调用配置的生图模型。</p><ol className="rh-help-list"><li>在账户管理填写 API Base URL 和 API Key，刷新模型或手动填写模型 ID。</li><li>选择模型后，按可用选项设置分辨率和比例，再填写提示词。</li><li>点击捕获图像，点击开始运行，等待回图。</li></ol></div>
                <div className="xl-popup-actions"><button type="button" className="xl-btn xl-btn-primary" onClick={() => setHelpOpen(false)}>知道了</button></div>
            </div></div>}
        </>
    );
}

function BananaQueueCard({ runs, onDismiss, onRetryPlace }) {
    const [open, setOpen] = useState(true);
    return <div className={`wfa-card rh-queue-card ${open ? "" : "is-collapsed"}`}>
        <WorkspaceSectionHeader title={`任务队列${runs.length ? ` · ${runs.length}` : ""}`} open={open} onToggle={() => setOpen(value => !value)} />
        <div className={`card-content ${open ? "" : "collapsed"}`}><div className="rh-task-queue">
            {!runs.length ? <div className="rh-task-empty">暂无任务</div> : runs.map((run) => {
                const platform = run.platform || "banana";
                const own = platform === "banana";
                const platformLabel = own ? "织影" : platform === "runninghub" ? "RunningHub" : "Comfy UI";
                const name = own ? `${run.providerName || "织影"} · ${run.model || ""}` : run.presetName || run.workflowName || run.platform;
                const pending = run.placeStatus === "pending";
                const submitTime = new Date(run.startTime);
                const time = `${submitTime.getHours().toString().padStart(2, "0")}:${submitTime.getMinutes().toString().padStart(2, "0")}`;
                const elapsed = run.elapsedSec || (run.completedAt ? (run.completedAt - run.startTime) / 1000 : 0);
                const duration = elapsed < 60 ? `${elapsed.toFixed(1)}秒` : `${Math.floor(elapsed / 60)}分${Math.round(elapsed % 60)}秒`;
                const batch = batchProgressText(run);
                return <div key={run.id} className="rh-task-item">
                    <TaskPreviewThumb src={run.pendingUploads?.main?.previewBase64} title="查看任务大图" />
                    <div className="rh-task-status-wrapper"><div className={`rh-task-status ${run.status === "success" ? "success" : run.status === "running" ? "running" : run.status === "cancelled" ? "warning" : "error"}`} /></div>
                    <div className="rh-task-info"><div className="rh-task-name">{name}</div><div className="rh-task-meta"><span className={`rh-task-platform-badge rh-task-platform-badge--${platform}`}>{platformLabel}</span><span className="rh-task-time">{time} 提交</span><span className="rh-task-duration">{duration}</span></div><div className="rh-task-progress">{formatRunStatus(run)}{batch && <span className="rh-task-stage" title={batch}>{batch}</span>}{run.stageText && <span className="rh-task-stage">{run.stageText}</span>}</div></div>
                    <div className="rh-task-actions">{pending && <button type="button" className="rh-task-retry" onClick={() => onRetryPlace?.(run.platform || "banana", run.id)} title="贴回图片">↗</button>}<button type="button" className="rh-task-close" onClick={() => onDismiss?.(run.platform || "banana", run.id)} title="关闭任务">×</button></div>
                </div>;
            })}
        </div></div>
    </div>;
}

function BananaPromptPresetMenu({ presets, presetName, setPresetName, currentPrompt, onSelect, onSave, onDelete }) {
    const items = Array.isArray(presets) ? presets : [];
    const canSave = String(currentPrompt || "").trim() && String(presetName || "").trim();
    return (
        <div className="banana-prompt-preset-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="banana-prompt-preset-save">
                <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="预设名称" />
                <button type="button" disabled={!canSave} onClick={onSave}>保存</button>
            </div>
            <div className="banana-prompt-preset-list">
                {!items.length ? (
                    <div className="banana-prompt-preset-empty">暂无提示词预设</div>
                ) : items.map((item) => (
                    <div key={item.id} className="banana-prompt-preset-item">
                        <button type="button" className="banana-prompt-preset-select" onClick={() => onSelect(item)} title={item.prompt || item.name}>
                            {item.name}
                        </button>
                        <button
                            type="button"
                            className="banana-prompt-preset-delete"
                            title="删除预设"
                            onClick={() => onDelete(item.id)}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BananaPromptHistoryMenu({ history, onSelect }) {
    const items = normalizePromptHistory(history);
    return (
        <div className="banana-prompt-preset-menu banana-prompt-history-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="banana-prompt-preset-list banana-prompt-history-list">
                {!items.length ? (
                    <div className="banana-prompt-preset-empty">暂无历史提示词</div>
                ) : items.map((item, index) => (
                    <div key={`${index}_${item}`} className="banana-prompt-preset-item banana-prompt-history-item">
                        <button type="button" className="banana-prompt-preset-select" onClick={() => onSelect(item)} title={item}>
                            {promptHistoryLabel(item)}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BananaHome({ state, actions, libraryUse }) {
    const [paramsOpen, setParamsOpen] = useState(false);
    const [paramMenuStyle, setParamMenuStyle] = useState(null);
    const [captureOpen, setCaptureOpen] = useState(true);
    const [promptOpen, setPromptOpen] = useState(true);
    const promptInput = useRef(null);
    useEffect(() => {
        if (!libraryUse) return undefined;
        setPromptOpen(true);
        const frame = requestAnimationFrame(() => {
            const field = promptInput.current;
            field?.focus({ preventScroll: true });
            field?.setSelectionRange(field.value.length, field.value.length);
            field?.scrollIntoView({ block: "nearest" });
        });
        return () => cancelAnimationFrame(frame);
    }, [libraryUse]);
    const [promptPresetOpen, setPromptPresetOpen] = useState(false);
    const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
    const [promptPresetMenuStyle, setPromptPresetMenuStyle] = useState(null);
    const [promptHistoryMenuStyle, setPromptHistoryMenuStyle] = useState(null);
    const [promptPresetButtonStyle, setPromptPresetButtonStyle] = useState(null);
    const [promptHistoryButtonStyle, setPromptHistoryButtonStyle] = useState(null);
    const [promptPresetName, setPromptPresetName] = useState("");
    const paramsRef = useRef(null);
    const paramsMenuRef = useRef(null);
    const promptPresetBtnRef = useRef(null);
    const promptPresetMenuRef = useRef(null);
    const promptHistoryBtnRef = useRef(null);
    const promptHistoryMenuRef = useRef(null);
    const activeModel = state.modelId;
    const modelOptions = Array.from(new Set([activeModel, ...state.models])).filter(Boolean);
    const defaultImageValue = activeModel ? "模型默认" : "请先选择模型";
    const { size, aspectRatio, sizes, ratios } = state.imageSelection;
    useEffect(() => {
        if (!paramsOpen) return undefined;
        const onMouseDown = (event) => {
            const target = event.target;
            if (paramsRef.current?.contains(target)) return;
            if (paramsMenuRef.current?.contains(target)) return;
            if (target?.closest?.(".wfa-param-select-menu")) return;
            setParamsOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [paramsOpen]);
    useEffect(() => {
        if (!promptPresetOpen && !promptHistoryOpen) return undefined;
        const onMouseDown = (event) => {
            const target = event.target;
            if (promptPresetBtnRef.current?.contains(target)) return;
            if (promptPresetMenuRef.current?.contains(target)) return;
            if (promptHistoryBtnRef.current?.contains(target)) return;
            if (promptHistoryMenuRef.current?.contains(target)) return;
            setPromptPresetOpen(false);
            setPromptHistoryOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [promptPresetOpen, promptHistoryOpen]);
    const refreshParamMenuStyle = useCallback(() => {
        setParamMenuStyle(bananaParamMenuStyle(paramsRef.current));
    }, []);
    const refreshPromptPresetMenuStyle = useCallback(() => {
        setPromptPresetMenuStyle(bananaPromptMenuStyle(promptPresetBtnRef.current));
        setPromptPresetButtonStyle(bananaPromptPresetButtonStyle(promptPresetBtnRef.current));
    }, []);
    const refreshPromptHistoryMenuStyle = useCallback(() => {
        setPromptHistoryMenuStyle(bananaPromptMenuStyle(promptHistoryBtnRef.current));
        setPromptHistoryButtonStyle(bananaPromptPresetButtonStyle(promptHistoryBtnRef.current));
    }, []);
    useLayoutEffect(() => {
        if (!paramsOpen) {
            setParamMenuStyle(null);
            return undefined;
        }
        refreshParamMenuStyle();
        window.addEventListener("scroll", refreshParamMenuStyle, true);
        window.addEventListener("resize", refreshParamMenuStyle);
        return () => {
            window.removeEventListener("scroll", refreshParamMenuStyle, true);
            window.removeEventListener("resize", refreshParamMenuStyle);
        };
    }, [paramsOpen, refreshParamMenuStyle]);
    useLayoutEffect(() => {
        if (!promptPresetOpen) {
            setPromptPresetMenuStyle(null);
            setPromptPresetButtonStyle(null);
            return undefined;
        }
        refreshPromptPresetMenuStyle();
        window.addEventListener("scroll", refreshPromptPresetMenuStyle, true);
        window.addEventListener("resize", refreshPromptPresetMenuStyle);
        return () => {
            window.removeEventListener("scroll", refreshPromptPresetMenuStyle, true);
            window.removeEventListener("resize", refreshPromptPresetMenuStyle);
        };
    }, [promptPresetOpen, refreshPromptPresetMenuStyle]);
    useLayoutEffect(() => {
        if (!promptHistoryOpen) {
            setPromptHistoryMenuStyle(null);
            setPromptHistoryButtonStyle(null);
            return undefined;
        }
        refreshPromptHistoryMenuStyle();
        window.addEventListener("scroll", refreshPromptHistoryMenuStyle, true);
        window.addEventListener("resize", refreshPromptHistoryMenuStyle);
        return () => {
            window.removeEventListener("scroll", refreshPromptHistoryMenuStyle, true);
            window.removeEventListener("resize", refreshPromptHistoryMenuStyle);
        };
    }, [promptHistoryOpen, refreshPromptHistoryMenuStyle]);
    const paramsMenu = (
        <div ref={paramsMenuRef} className="banana-param-menu banana-param-menu--portal" style={paramMenuStyle}>
            <div className="banana-controls">
                <CustomSelect label="供应商" value={state.provider} displayValue={state.supplierName} options={state.providerOptions} getItemLabel={(item) => state.providerNames[item]} onChange={actions.setProvider} dropdownPlacement="down" useDropdownPortal />
                <CustomSelect label="模型" value={activeModel} displayValue={activeModel || (modelOptions.length ? "请选择模型" : "请刷新模型")} options={modelOptions} onChange={actions.setModel} dropdownPlacement="down" useDropdownPortal />
                <CustomSelect label="分辨率" value={size} displayValue={size || defaultImageValue} options={["", ...sizes]}
                    getItemLabel={(value) => value || "模型默认"} onChange={(value) => actions.setImageOption("size", value)}
                    disabled={!sizes.length} dropdownPlacement="down" useDropdownPortal />
                <CustomSelect label="比例" value={aspectRatio} displayValue={aspectRatio || defaultImageValue} options={["", ...ratios]}
                    getItemLabel={(value) => value || "模型默认"} onChange={(value) => actions.setImageOption("aspectRatio", value)}
                    disabled={!ratios.length} dropdownPlacement="down" useDropdownPortal />
                <Stepper label="并发" value={state.concurrency} min={1} max={8} onChange={actions.setConcurrency} />
                <Stepper label="超时" value={state.timeoutSec} min={60} max={1800} onChange={actions.setTimeoutSec} suffix="s" />
            </div>
        </div>
    );
    const promptPresetMenu = (
        <div ref={promptPresetMenuRef} className="banana-prompt-preset-menu-portal" style={promptPresetMenuStyle}>
            <BananaPromptPresetMenu
                presets={state.promptPresets}
                presetName={promptPresetName}
                setPresetName={setPromptPresetName}
                currentPrompt={state.prompt}
                onSelect={(item) => {
                    actions.setPrompt(item.prompt || "");
                    setPromptPresetOpen(false);
                }}
                onSave={async () => {
                    if (await actions.savePromptPreset(promptPresetName)) setPromptPresetName("");
                }}
                onDelete={actions.deletePromptPreset}
            />
        </div>
    );
    const promptHistoryMenu = (
        <div ref={promptHistoryMenuRef} className="banana-prompt-preset-menu-portal" style={promptHistoryMenuStyle}>
            <BananaPromptHistoryMenu
                history={state.promptHistory}
                onSelect={(item) => {
                    actions.setPrompt(item || "");
                    setPromptHistoryOpen(false);
                }}
            />
        </div>
    );
    return <div className="banana-home wfa-workspace-body">
        <div ref={paramsRef} className={"banana-param-dropdown" + (paramsOpen ? " is-open" : "")}>
            <button type="button" className="banana-param-trigger wfa-workspace-field" onClick={() => setParamsOpen((value) => !value)} aria-expanded={paramsOpen}>
                <span className="banana-param-trigger-content">
                    <span className="banana-param-trigger-label">参数设置</span>
                    <span className={"banana-param-trigger-caret" + (paramsOpen ? " is-open" : "")} />
                </span>
            </button>
            <BananaLatencyToast result={state.probeResult} />
            {paramsOpen && paramMenuStyle && typeof document !== "undefined" && document.body
                ? createPortal(paramsMenu, document.body)
                : null}
        </div>
        <div className="rh-run-section">
            <button type="button" className={`rh-run-btn ${state.submitting ? "running" : ""}`} disabled={state.submitting} onClick={actions.run}>
                {state.submitting ? <span className="rh-run-btn-spinner" /> : <PlayIcon />}
                {state.submitting ? "正在提交..." : "开始运行"}
            </button>
            <div className="rh-upload-status-bar banana-status-bar">
                <div className="rh-status-text banana-status-line" title={`${state.statusText || "就绪"} 当前线路：${state.endpointLabel}`}>
                    <span role="status">{state.statusText || "就绪"}</span>
                    <span className="banana-status-route">当前线路：{state.endpointLabel}</span>
                </div>
                <div className="rh-progress-bar"><div className="rh-progress-fill" style={{ width: `${state.progress}%` }} /></div>
            </div>
        </div>
        <div className={`wfa-card banana-capture-card ${captureOpen ? "" : "is-collapsed"}`}>
            <WorkspaceSectionHeader title="捕获图像" open={captureOpen} onToggle={() => setCaptureOpen(value => !value)}>
                <button
                    type="button"
                    className={`banana-prompt-preset-btn banana-multi-image-btn ${state.multiImageMode ? "is-open" : ""}`}
                    title="多图模式"
                    aria-label="多图模式"
                    onClick={(event) => {
                        event.stopPropagation();
                        actions.setMultiImageMode(!state.multiImageMode);
                    }}
                >
                    多图
                </button>
            </WorkspaceSectionHeader>
            <div className={`card-content ${captureOpen ? "" : "collapsed"}`}>
                {state.multiImageMode ? (
                    <div className="banana-multi-capture">
                        <RhImagePreviewField
                            label="图一"
                            pending={state.pendingUpload}
                            busy={state.capturing === BANANA_MAIN_IMAGE_SLOT}
                            onCapture={() => actions.capture(BANANA_MAIN_IMAGE_SLOT)}
                            onClear={() => actions.clearCapture(BANANA_MAIN_IMAGE_SLOT)}
                        />
                        <div className="banana-multi-ref-row">
                            {BANANA_REF_IMAGE_SLOTS.map((slot) => (
                                <RhImagePreviewField
                                    key={slot.key}
                                    label={slot.label}
                                    pending={state.multiUploads?.[slot.key]}
                                    busy={state.capturing === slot.key}
                                    onCapture={() => actions.capture(slot.key)}
                                    onClear={() => actions.clearCapture(slot.key)}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <RhImagePreviewField label="图像" pending={state.pendingUpload} busy={!!state.capturing} onCapture={actions.capture} onClear={actions.clearCapture} />
                )}
            </div>
        </div>
        <div className={`wfa-card banana-prompt-card ${promptOpen ? "" : "is-collapsed"}`}>
            <WorkspaceSectionHeader title="提示词" open={promptOpen} onToggle={() => setPromptOpen(value => !value)}>
                <button
                    ref={promptHistoryBtnRef}
                    type="button"
                    className={`banana-prompt-preset-btn ${promptHistoryOpen ? "is-open" : ""}`}
                    title="历史提示词"
                    aria-label="历史提示词"
                    onClick={(event) => {
                        event.stopPropagation();
                        setPromptPresetOpen(false);
                        setPromptHistoryOpen((value) => !value);
                    }}
                >
                    历史
                </button>
                <button
                    ref={promptPresetBtnRef}
                    type="button"
                    className={`banana-prompt-preset-btn ${promptPresetOpen ? "is-open" : ""}`}
                    title="提示词预设"
                    aria-label="提示词预设"
                    onClick={(event) => {
                        event.stopPropagation();
                        setPromptHistoryOpen(false);
                        setPromptPresetOpen((value) => !value);
                    }}
                >
                    预设
                </button>
            </WorkspaceSectionHeader>
            {promptPresetOpen && promptPresetMenuStyle && typeof document !== "undefined" && document.body
                ? createPortal(promptPresetMenu, document.body)
                : null}
            {promptHistoryOpen && promptHistoryMenuStyle && typeof document !== "undefined" && document.body
                ? createPortal(promptHistoryMenu, document.body)
                : null}
            {promptPresetOpen && promptPresetButtonStyle && typeof document !== "undefined" && document.body
                ? createPortal(
                    <button
                        type="button"
                        className="banana-prompt-preset-btn banana-prompt-preset-btn--portal is-open"
                        style={promptPresetButtonStyle}
                        tabIndex={-1}
                        aria-hidden="true"
                    >
                        预设
                    </button>,
                    document.body
                )
                : null}
            {promptHistoryOpen && promptHistoryButtonStyle && typeof document !== "undefined" && document.body
                ? createPortal(
                    <button
                        type="button"
                        className="banana-prompt-preset-btn banana-prompt-preset-btn--portal is-open"
                        style={promptHistoryButtonStyle}
                        tabIndex={-1}
                        aria-hidden="true"
                    >
                        历史
                    </button>,
                    document.body
                )
                : null}
            <div className={`card-content ${promptOpen ? "" : "collapsed"}`}><textarea ref={promptInput} aria-label="织影提示词" className="banana-prompt-textarea" value={state.prompt} onChange={(event) => actions.setPrompt(event.target.value)} placeholder="描述想要生成或修改的图像效果..." /></div>
        </div>
        <BananaQueueCard runs={state.queueRuns} onDismiss={actions.dismiss} onRetryPlace={actions.retryPlace} />
    </div>;
}

export function BananaShell({ activeProduct = "banana", onChangeProduct, sharedSettings, onRunsChange, sharedTaskRuns, onDismissSharedRun, onRetrySharedPlace, onRegisterTaskActions, prompt, setPrompt, libraryUse, onPromptPresetsChange }) {
    const { pushStatus } = sharedSettings;
    const [page, setPage] = useState("home");
    useEffect(() => { if (libraryUse) setPage("home"); }, [libraryUse]);
    const [selectedProvider, setProvider] = usePersistedState("banana_provider", ZHIYING);
    const [builtInProfile, setBuiltInProfile] = usePersistedState("banana_zhiying_profile", EMPTY_PROFILE);
    const [savedProviders, setSavedProviders] = usePersistedState("banana_custom_providers", []);
    const customProfiles = Array.isArray(savedProviders) ? savedProviders : [];
    const activeCustom = customProfiles.find((item) => item.id === selectedProvider);
    const provider = activeCustom?.id || (selectedProvider === CUSTOM ? CUSTOM : ZHIYING);
    const profile = provider === ZHIYING ? builtInProfile || EMPTY_PROFILE : activeCustom || EMPTY_PROFILE;
    const supplierName = provider === ZHIYING ? "织影" : profile.name.trim() || "自定义";
    const providerOptions = [ZHIYING, ...customProfiles.map((item) => item.id)];
    const providerNames = Object.fromEntries([[ZHIYING, "织影"], ...customProfiles.map((item) => [item.id, item.name.trim() || "未命名供应商"])]);
    const [modelLists, setModelLists] = useState({});
    const cached = modelLists[provider];
    const modelResult = cached?.baseUrl === profile.baseUrl && cached?.protocol === profile.protocol && cached?.apiKey === profile.apiKey ? cached : null;
    const models = modelResult?.models || [];
    const optionsByModel = modelResult?.byModel;
    const refreshing = modelResult?.pending === true;
    const modelRequestSequence = useRef(0);
    const patchProfile = (patch) => {
        if (provider === ZHIYING) setBuiltInProfile(patch);
        else setSavedProviders((current) => current.map((item) => item.id === provider ? patch(item) : item));
    };
    const updateProfile = (field, value) => patchProfile(current => ({ ...current, [field]: value }));
    const addProvider = () => {
        const id = "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
        setSavedProviders((current) => [...(Array.isArray(current) ? current : []), { ...EMPTY_PROFILE, id, name: "自定义 " + (customProfiles.length + 1) }]);
        setProvider(id);
    };
    const [previousSize] = usePersistedState("banana_size", "");
    const selectedModel = String(profile.model || "").trim();
    const modelRejected = !models.includes(selectedModel) &&
        (modelResult?.excludedModels?.includes(selectedModel) === true || imageModelKind(selectedModel) === "non-image");
    const modelId = modelRejected ? "" : selectedModel;
    const imageChoice = profile.imageOptionsByModel?.[modelId] ||
        (profile.protocol === OPENAI_IMAGES ? null : { size: previousSize });
    const imageSelection = resolveModelImageSelection(optionsByModel?.[modelId], imageChoice, profile.protocol);
    const setImageOption = (key, value) => {
        if (!modelId) return;
        const choice = profile.protocol === OPENAI_IMAGES
            ? { [key]: value }
            : { size: imageSelection.size, aspectRatio: imageSelection.aspectRatio, [key]: value };
        patchProfile(current => ({ ...current, imageOptionsByModel: { ...current.imageOptionsByModel, [modelId]: choice } }));
    };
    const [concurrency, setConcurrency] = usePersistedState("banana_concurrency", 1);
    const [timeoutSec, setTimeoutSec] = usePersistedState("banana_timeout_sec", 600);
    const [promptPresets, setPromptPresets] = useState([]);
    const [promptHistory, setPromptHistory] = usePersistedState("banana_prompt_history", []);
    const [pendingUpload, setPendingUpload] = usePersistedState("banana_pending_upload", null);
    const [multiImageMode, setMultiImageMode] = usePersistedState("banana_multi_image_mode", false);
    const [multiUploads, setMultiUploads] = usePersistedState("banana_multi_uploads", {});
    const [runs, setRuns] = useState([]);
    const [capturing, setCapturing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [statusText, setStatusText] = useState("");
    const [probeResult, setProbeResult] = useState(null);
    const cancelRefs = useRef({});
    const submitBusyRef = useRef(null);
    const autoPlaceQueueRef = useRef(Promise.resolve());
    const { confirmCaptureSelection, warningDialog } = useSquareSelectionWarning(pushStatus);
    const isHome = page === "home";
    const config = profile;
    const normalizedPromptPresets = useMemo(() => (Array.isArray(promptPresets) ? promptPresets : []).filter((item) => item?.id && item?.name && item?.prompt), [promptPresets]);
    useEffect(() => { onPromptPresetsChange?.(normalizedPromptPresets); }, [normalizedPromptPresets, onPromptPresetsChange]);
    const updateRun = useCallback((id, patch) => setRuns((items) => items.map((item) => item.id === id ? { ...item, ...patch, elapsedSec: elapsedSeconds(item.startTime) } : item)), []);

    useEffect(() => { removeCompatLocalStorage("banana_prompt"); }, []);
    useEffect(() => {
        let alive = true;
        loadBananaPromptPresets()
            .then((items) => { if (alive) setPromptPresets(items); })
            .catch((error) => pushStatus(`提示词预设读取失败：${error?.message || error}`, 3500));
        return () => { alive = false; };
    }, [pushStatus]);
    useEffect(() => { onRunsChange?.(runs); }, [onRunsChange, runs]);
    useEffect(() => {
        const id = setInterval(() => setRuns((items) => items.map((run) => run.status === "running" ? { ...run, elapsedSec: elapsedSeconds(run.startTime) } : run)), 500);
        return () => clearInterval(id);
    }, []);
    useEffect(() => {
        const id = setInterval(() => setRuns((items) => pruneCompletedRhRuns(items)), 15000);
        return () => clearInterval(id);
    }, []);

    const showProbeResult = useCallback((result) => {
        const id = Date.now();
        setProbeResult({ ...result, id });
        setTimeout(() => {
            setProbeResult((current) => current?.id === id ? null : current);
        }, 1900);
    }, []);

    const refresh = useCallback(async () => {
        if (refreshing || provider === CUSTOM) return;
        const requestId = ++modelRequestSequence.current;
        setModelLists((current) => ({
            ...current,
            [provider]: { baseUrl: config.baseUrl, protocol: config.protocol, apiKey: config.apiKey, requestId,
                models, byModel: optionsByModel, excludedModels: modelResult?.excludedModels, pending: true },
        }));
        const finish = (patch) => {
            setModelLists((current) => current[provider]?.requestId === requestId
                ? { ...current, [provider]: { ...current[provider], ...patch, pending: false } }
                : current);
        };
        try {
            const result = await fetchBananaModels(config);
            finish({ models: result.models, byModel: result.byModel, excludedModels: result.excludedModels });
            showProbeResult({ ok: true, latencyMs: result.latencyMs, label: result.endpointLabel });
            pushStatus(result.models.length ? `已拉取 ${result.models.length} 个图像模型` : "未识别到图像模型，请检查供应商或手动填写图像模型 ID", 3500);
        } catch (error) {
            const message = error?.message || "未能读取供应商的模型列表";
            finish({ error: message });
            pushStatus("拉取模型失败：" + message, 6000);
        }
    }, [config, models, optionsByModel, modelResult?.excludedModels, provider, pushStatus, refreshing, showProbeResult]);

    const clearCapture = useCallback((slotKey = BANANA_MAIN_IMAGE_SLOT) => {
        const key = slotKey || BANANA_MAIN_IMAGE_SLOT;
        if (key === BANANA_MAIN_IMAGE_SLOT) {
            releaseUploadRecord(pendingUpload);
            setPendingUpload(null);
            return;
        }
        releaseUploadRecord(multiUploads?.[key]);
        setMultiUploads((current) => {
            const next = { ...(current || {}) };
            delete next[key];
            return next;
        });
    }, [multiUploads, pendingUpload, setMultiUploads, setPendingUpload]);

    const savePromptPreset = useCallback(async (name) => {
        const presetName = String(name || "").trim();
        const presetPrompt = String(prompt || "").trim();
        if (!presetPrompt) return pushStatus("请先填写提示词", 2500);
        if (!presetName) return pushStatus("请先填写预设名称", 2500);
        const existing = normalizedPromptPresets.find((item) => item?.name === presetName);
        const next = { id: existing?.id || `banana_prompt_${Date.now()}`, name: presetName, prompt: presetPrompt, updatedAt: Date.now(), fileName: existing?.fileName };
        try {
            await saveBananaPromptPresetFile(next);
            setPromptPresets(await loadBananaPromptPresets());
        } catch (error) {
            pushStatus(`提示词预设保存失败：${error?.message || error}`, 4500);
            return false;
        }
        pushStatus(`已保存提示词预设：${presetName}`, 2500);
        return true;
    }, [normalizedPromptPresets, prompt, pushStatus]);

    const deletePromptPreset = useCallback(async (id) => {
        const preset = normalizedPromptPresets.find((item) => item?.id === id);
        try {
            await deleteBananaPromptPresetFile(preset);
            setPromptPresets(await loadBananaPromptPresets());
        } catch (error) {
            pushStatus(`提示词预设删除失败：${error?.message || error}`, 4500);
            return;
        }
        pushStatus("已删除提示词预设", 2200);
    }, [normalizedPromptPresets, pushStatus]);

    const capture = useCallback(async (slotKey = BANANA_MAIN_IMAGE_SLOT) => {
        if (capturing) return;
        const key = slotKey || BANANA_MAIN_IMAGE_SLOT;
        const previous = key === BANANA_MAIN_IMAGE_SLOT ? pendingUpload : multiUploads?.[key];
        const okay = await confirmCaptureSelection({ mode: "canvas", clearCapture: () => clearCapture(key), requireSelection: true });
        if (!okay) return;
        setCapturing(key);
        try {
            const item = uploadFromCapture(await captureBananaImage(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat), previous);
            if (!item) throw new Error("图像捕获失败");
            releaseUploadRecord(previous);
            if (key === BANANA_MAIN_IMAGE_SLOT) {
                setPendingUpload(item);
            } else {
                setMultiUploads((current) => ({ ...(current || {}), [key]: item }));
            }
            pushStatus(`${bananaSlotLabel(key)}已捕获`, 2000);
        } catch (error) { pushStatus(`捕获失败：${error?.message || error}`, 5000); }
        finally { setCapturing(false); }
    }, [capturing, clearCapture, confirmCaptureSelection, multiUploads, pendingUpload, pushStatus, setMultiUploads, setPendingUpload, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax]);

    const enqueueAutoPlace = useCallback((savedFileNames, groupName, bounds, placeToken, docId, options = {}) => {
        const prev = autoPlaceQueueRef.current.catch(() => {});
        const next = prev.then(() => performAutoPlace(savedFileNames, groupName, bounds, placeToken, docId, { force: true, group: options.group !== false }));
        autoPlaceQueueRef.current = next.catch(() => {});
        return next;
    }, []);

    const run = useCallback(async () => {
        const model = modelId;
        if (!prompt.trim()) return pushStatus("请填写提示词", 3500);
        if (!model) return pushStatus("请先填写或选择图像模型", 3500);
        let runConfig;
        try { runConfig = resolveBananaRunConfig(config); }
        catch (error) { return pushStatus(error.message, 3500); }
        if (submitBusyRef.current) return;
        const submitLock = Symbol("bananaSubmit");
        const releaseSubmitLock = () => {
            if (submitBusyRef.current !== submitLock) return;
            submitBusyRef.current = null;
            setSubmitting(false);
        };
        submitBusyRef.current = submitLock;
        setSubmitting(true);
        let image = pendingUpload;
        if (!image?.base64 && !image?.uploadSessionId) {
            const okay = await confirmCaptureSelection({ mode: "canvas", clearCapture, requireSelection: true });
            if (!okay) {
                releaseSubmitLock();
                return;
            }
            setCapturing(BANANA_MAIN_IMAGE_SLOT);
            try {
                image = uploadFromCapture(await captureBananaImage(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat), pendingUpload);
            } catch (error) {
                releaseSubmitLock();
                return pushStatus(`图像捕获失败：${error?.message || error}`, 5000);
            } finally {
                setCapturing(false);
            }
            if (!image) {
                releaseSubmitLock();
                return pushStatus("图像捕获失败", 4000);
            }
            releaseUploadRecord(pendingUpload);
            setPendingUpload(image);
        }
        let imageEntries = bananaImageEntries(image, multiUploads, multiImageMode);
        try {
            imageEntries = await Promise.all(imageEntries.map(async (entry) => ({ ...entry, record: await materializeUploadRecord(entry.record) })));
            image = imageEntries.find((entry) => entry.key === BANANA_MAIN_IMAGE_SLOT)?.record;
            setPendingUpload(image);
            if (multiImageMode) {
                setMultiUploads((current) => {
                    const next = { ...(current || {}) };
                    for (const entry of imageEntries) {
                        if (entry.key !== BANANA_MAIN_IMAGE_SLOT) next[entry.key] = entry.record;
                    }
                    return next;
                });
            }
        } catch (error) {
            releaseSubmitLock();
            return pushStatus(`图像编码失败：${error?.message || error}`, 5000);
        }
        if (!image?.base64) {
            releaseSubmitLock();
            return pushStatus("图像编码失败", 4000);
        }
        const requestImages = imageEntries.map((entry) => entry.record).filter((item) => item?.base64);
        const runId = `banana_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const total = Math.max(1, Math.min(8, Number(concurrency) || 1));
        const timeoutMs = Math.max(60, Number(timeoutSec) || 600) * 1000;
        const placeContext = normalizePlaceContext({ docId: image?.docId, bounds: image?.bounds }) || await recordPlaceContext();
        const promptSnapshot = bananaPromptWithImageLabels(prompt, imageEntries, multiImageMode);
        const task = { model, size: imageSelection.size, aspectRatio: imageSelection.aspectRatio, prompt: promptSnapshot, timeoutMs };
        setPromptHistory((items) => addPromptHistoryItem(items, prompt));
        setPrompt("");
        cancelRefs.current[runId] = false;
        setSubmitting(true);
        setStatusText(total > 1 ? `并发执行中 0/${total}` : "正在提交");
        setRuns((items) => [...items, { id: runId, status: "running", progress: 5, stageText: "准备任务", startTime: Date.now(), elapsedSec: 0, provider, providerName: supplierName, model, total, doneCount: 0, failedCount: 0, batchTotal: total, batchImageTotal: total, batchDone: 0, pendingUploads: Object.fromEntries(imageEntries.map((entry) => [entry.key, entry.record])) }]);
        try {
            updateRun(runId, { stageText: `线路 ${runConfig.endpointLabel || runConfig.baseUrl}`, progress: 10 });
            let settled = 0;
            const requests = Array.from({ length: total }, (_, index) => runBananaImage(runConfig, task, requestImages)
                .then((urls) => ({ index, urls }), (error) => ({ index, error }))
                .then((result) => {
                    settled += 1;
                    updateRun(runId, { stageText: total > 1 ? `并发执行中 ${settled}/${total}` : "执行中", progress: Math.min(70, 12 + Math.round(settled * 48 / total)) });
                    setStatusText(total > 1 ? `并发执行中 ${settled}/${total}` : "执行中");
                    return result;
                }));
            releaseSubmitLock();
            const results = await Promise.all(requests);
            if (cancelRefs.current[runId]) throw new Error("已取消");
            updateRun(runId, { stageText: total > 1 ? "并发结束，统一保存回图" : "保存回图", progress: 74 });
            setStatusText(total > 1 ? "并发结束，统一回传" : "保存回图");
            const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_BANANA);
            const folder = token ? await uxpFs.getEntryForPersistentToken(token) : await getTempResultFolder();
            const placeToken = token || folder?.token || null;
            if (!folder || !placeToken) throw new Error("无法访问回图缓存目录");
            const saved = [];
            let complete = 0;
            let failed = 0;
            for (const result of results) {
                if (cancelRefs.current[runId]) throw new Error("已取消");
                if (result.error) { failed += 1; updateRun(runId, { failedCount: failed, stageText: result.error?.message || "子任务失败" }); continue; }
                for (const url of result.urls) {
                    const file = await saveImageWithBounds(folder, url, saved.length + 1, { bounds: placeContext?.bounds ?? null, docId: placeContext?.docId ?? null, runningHubAppName: "织影", resultSidecar: { platform: "banana", provider, model } });
                    saved.push(file.fileName);
                }
                complete += 1;
                notifyResultFilesChanged({ folderToken: placeToken });
                updateRun(runId, { progress: Math.min(92, 75 + Math.round(complete * 17 / total)), doneCount: complete, failedCount: failed, batchDone: saved.length, batchImageTotal: Math.max(total, saved.length), stageText: total > 1 ? `统一保存 ${complete}/${total}` : "保存回图" });
            }
            if (!saved.length) throw results.find((item) => item.error)?.error || new Error("没有成功返回图片");
            const autoReturn = readAutoReturnEnabled();
            const concurrentGroupOn = readConcurrentReturnGroupEnabled();
            let placePatch = { placeStatus: autoReturn ? "placed" : "pending", placeSavedFileNames: saved, placeToken, placeBounds: placeContext?.bounds ?? null, placeDocId: placeContext?.docId ?? null, placeGroupName: "织影生成", placeGroupEnabled: total > 1 ? concurrentGroupOn : true };
            if (autoReturn) {
                updateRun(runId, { stageText: "统一回传到 PS", progress: 95 });
                try { await enqueueAutoPlace(saved, "织影生成", placeContext?.bounds ?? null, placeToken, placeContext?.docId ?? null, { group: total > 1 ? concurrentGroupOn : true }); }
                catch (error) { placePatch = { ...placePatch, placeStatus: error?.canRetry ? "pending" : "failed", placeError: error?.reason || error?.message || String(error) }; }
            }
            updateRun(runId, { status: "success", progress: 100, doneCount: complete, failedCount: failed, batchDone: saved.length, batchImageTotal: Math.max(total, saved.length), stageText: failed ? `完成 ${complete}/${total}，部分失败` : "已完成", completedAt: Date.now(), ...placePatch });
            setStatusText(failed ? `完成 ${complete}/${total}，部分失败` : "已完成");
            playSound({ fileName: readSuccessSoundFile(sharedSettings.successSoundFile) });

        } catch (error) {
            const cancelled = cancelRefs.current[runId] === true || String(error?.message || "") === "已取消";
            updateRun(runId, { status: cancelled ? "cancelled" : "error", progress: 100, stageText: error?.message || String(error), completedAt: Date.now() });
            setStatusText(cancelled ? "已取消" : `运行失败：${error?.message || error}`);
            if (!cancelled) playSoundFail({ fileName: readFailSoundFile(sharedSettings.failSoundFile) });
        } finally {
            delete cancelRefs.current[runId];
            releaseSubmitLock();
        }
    }, [clearCapture, concurrency, config, confirmCaptureSelection, enqueueAutoPlace, imageSelection.size, imageSelection.aspectRatio, modelId, multiImageMode, multiUploads, pendingUpload, prompt, provider, pushStatus, setMultiUploads, setPendingUpload, setPromptHistory, sharedSettings.failSoundFile, sharedSettings.successSoundFile, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax, supplierName, timeoutSec, updateRun]);

    const dismiss = useCallback((id) => {
        cancelRefs.current[id] = true;
        setRuns((items) => items.filter((item) => item.id !== id));
    }, []);
    const retryPlace = useCallback(async (id) => {
        const run = runs.find((item) => item.id === id);
        if (!run?.placeSavedFileNames?.length || !run.placeToken) return;
        try {
            await enqueueAutoPlace(run.placeSavedFileNames, run.placeGroupName || "织影生成", run.placeBounds, run.placeToken, run.placeDocId, { group: run.placeGroupEnabled !== false });
            updateRun(id, { placeStatus: "placed", placeError: null });
            pushStatus("贴回成功", 2500);
        } catch (error) { updateRun(id, { placeError: error?.reason || error?.message || String(error) }); pushStatus(`贴回失败：${error?.reason || error?.message || error}`, 5000); }
    }, [enqueueAutoPlace, pushStatus, runs, updateRun]);
    useEffect(() => onRegisterTaskActions?.({ dismiss, retryPlace }), [dismiss, onRegisterTaskActions, retryPlace]);

    const queueRuns = sharedTaskRuns || runs;
    const dismissQueue = useCallback((platform, id) => onDismissSharedRun ? onDismissSharedRun(platform, id) : dismiss(id), [dismiss, onDismissSharedRun]);
    const retryQueue = useCallback((platform, id) => onRetrySharedPlace ? onRetrySharedPlace(platform, id) : retryPlace(id), [onRetrySharedPlace, retryPlace]);
    let endpointLabel = "未配置";
    try { endpointLabel = new URL(profile.baseUrl).host; } catch {}
    const state = { provider, modelId, supplierName, providerOptions, providerNames, models, imageSelection, concurrency, timeoutSec, prompt, promptPresets: normalizedPromptPresets, promptHistory, pendingUpload, multiImageMode, multiUploads, capturing, submitting, refreshing, statusText, progress: [...runs].reverse().find((run) => run.status === "running")?.progress || 0, queueRuns, endpointLabel, probeResult };
    const actions = { setProvider, setModel: (value) => updateProfile("model", value), setImageOption, setConcurrency, setTimeoutSec, setPrompt, setMultiImageMode, savePromptPreset, deletePromptPreset, refresh, capture, clearCapture, run, dismiss: dismissQueue, retryPlace: retryQueue };
    return <>
        {warningDialog}
        <BananaTopBar supplier={supplierName} loading={refreshing} onRefresh={refresh} isSettingsOpen={!isHome} onToggleView={() => setPage((current) => current === "home" ? "settings" : "home")} />
        <div className="banana-home-panel" style={{ display: isHome ? "flex" : "none", flex: "0 0 auto", minHeight: 0, flexDirection: "column" }}><BananaHome state={state} actions={actions} libraryUse={libraryUse} /></div>
        <div style={{ display: isHome ? "none" : "block", flex: 1, minHeight: 0 }}>
            <div className="banana-settings-wrap">
                <SettingsCard cardClass="rh-config-card banana-account-card" title="账户管理" defaultOpen>
                    <ZhiyingAccountSettings provider={provider} profile={profile} profiles={customProfiles}
                        onSelect={setProvider} onAdd={addProvider} onChange={updateProfile} onRefresh={refresh}
                        modelResult={modelResult} modelRejected={modelRejected} />
                </SettingsCard>
                <ComfySettings props={sharedSettings} workbenchId={RESULT_WORKBENCH_BANANA} productLabel="织影" />
            </div>
        </div>
    </>;
}

import { useCallback } from "react";
import { photoshop } from "../../bridge/uxpBridge.js";
import { runAiAppAndWait } from "../aiAppRunner.js";
import { RH_DEFAULT_BASE_URL } from "../constants.js";
import { rhFetchAccountStatus } from "../taskApi.js";
import { buildRhCostLine, buildRhSuccessSecondaryLine } from "../rhAccountDelta.js";
import { formatRhError, isRhPermissionError } from "../rhErrorCodes.js";
import {
    buildRhRunPayload,
    validateRhImageUploadPayloadReady,
    validateRhImageSlotUploadMappings,
} from "../rhInputUtils.js";
import { readAutoReturnEnabled } from "../../utils/sharedInteractionSettings.js";
import { saveImageWithBounds, getTempResultFolder } from "../../utils/imageSaver.js";
import {
    getEffectiveResultFolderToken,
    RESULT_WORKBENCH_RUNNINGHUB,
} from "../../utils/resultFolderTokens.js";
import { notifyResultFilesChanged } from "../../utils/resultFilesSync.js";
import { buildRhSuccessDisplayMessage, rhDisplayPhase } from "../ui/wfaRhWorkPanelLogic.js";

const storage = require("uxp").storage;
const fs = storage.localFileSystem;

function wfaPlainBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const { left, top, right, bottom } = bounds;
    return [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
}

const WFA_RUN_PHASE_PROGRESS = Object.freeze({
    upload: 0,
    submit: 20,
    poll_status: 30,
    fetch_result: 100,
    fetch_result_fallback: 100,
    failed: 100,
});

function wfaProgressPatchForPhase(phase, detail, extra, startTime) {
    const stage = rhDisplayPhase(phase, detail, extra);
    let progress = WFA_RUN_PHASE_PROGRESS[phase] ?? 50;
    if (extra?.displayMode === "node") progress = extra.progress ?? null;
    return {
        statusText: stage,
        runPatch: {
            phase,
            progress: progress ?? 0,
            stageText: stage || "运行中…",
            message: stage,
            displayStage: stage,
            elapsedSec: (Date.now() - startTime) / 1000,
        },
    };
}

function wfaBuildRunPayloadOrFailure(snapshot) {
    const imagePayload = validateRhImageUploadPayloadReady(snapshot.normalizedRows, snapshot.pendingUploads);
    if (!imagePayload.ok) return { ok: false, message: imagePayload.message || "图片上传数据未就绪" };
    const payload = buildRhRunPayload(snapshot.normalizedRows, snapshot.fieldValues, snapshot.pendingUploads);
    const mapping = validateRhImageSlotUploadMappings(snapshot.normalizedRows, payload.uploads);
    if (!mapping.ok) return { ok: false, message: mapping.message || "图像槽位映射校验失败" };
    return { ok: true, nodeInfoList: payload.nodeInfoList, uploads: payload.uploads };
}

async function wfaResolveRunPlaceTarget(snapshot) {
    const knownBounds = wfaPlainBounds(snapshot?.runSelectionBounds);
    let docId = snapshot?.runPlaceDocId ?? null;
    if (knownBounds && docId != null) return { bounds: knownBounds, docId };
    console.warn("[WfArtAssistant RunPlace] 贴回上下文不完整，读取当前文档兜底");
    try {
        const doc = await photoshop.app.getActiveDocument();
        if (docId == null) docId = doc?.id ?? null;
    } catch (_) {}
    return { bounds: knownBounds, docId };
}

async function wfaFetchAccountSnapshot(apiKeyTrim) {
    try {
        return await rhFetchAccountStatus(RH_DEFAULT_BASE_URL, apiKeyTrim, { timeoutMs: 6000 });
    } catch (_) {
        return null;
    }
}

function wfaPinAccountBaseline(ref, apiKeyTrim, account) {
    if (!account || !ref?.current) return;
    if (ref.current.apiKey === apiKeyTrim && ref.current.account) return;
    ref.current = { apiKey: apiKeyTrim, account };
}

export function useRhRunExecutor({
    pushStatus,
    setTaskIdLast,
    setNodeErrors,
    setRunError,
    resultRefreshRef,
    rhAccountCostBaselineRef,
    autoReturnEnabled,
    onRefreshAccount,
    isDuckDecodeEnabledNow,
    enqueueRhAutoPlace,
}) {
    return useCallback(
        async ({ snapshot, signal, updateRun, startTime }) => {
            /**
             * @param {RhRunSnapshot} resolvedSnap
             */
            const runOneResolved = async (resolvedSnap) => {
                const payload = wfaBuildRunPayloadOrFailure(resolvedSnap);
                if (!payload.ok) return { success: false, message: payload.message };
                const { bounds, docId } = await wfaResolveRunPlaceTarget(resolvedSnap);
                const accountBefore = await wfaFetchAccountSnapshot(resolvedSnap.apiKeyTrim);
                wfaPinAccountBaseline(rhAccountCostBaselineRef, resolvedSnap.apiKeyTrim, accountBefore);
                const res = await runAiAppAndWait({
                    apiKey: resolvedSnap.apiKeyTrim,
                    webappId: resolvedSnap.webappIdTrim,
                    nodeInfoList: payload.nodeInfoList,
                    uploads: payload.uploads,
                    baseUrl: RH_DEFAULT_BASE_URL,
                    signal,
                    onProgress: (phase, detail, extra) => {
                        if (signal.aborted) return;
                        const progressState = wfaProgressPatchForPhase(phase, detail, extra, startTime);
                        pushStatus(progressState.statusText, 0);
                        updateRun(progressState.runPatch);
                    },
                });
                if (res?.taskId) {
                    updateRun({ taskId: res.taskId });
                }

                if (signal.aborted || res.cancelled) {
                    return { cancelled: true, saved: 0, message: "已取消" };
                }
                if (res.success) {
                    setTaskIdLast(res.taskId || "");
                    setNodeErrors(res.nodeErrors || []);
                    const urls = res.fileUrls || [];
                    const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_RUNNINGHUB);
                    let successMsg = "";
                    let saved = 0;
                    if (urls.length > 0) {
                        try {
                            let folder = null;
                            let placeToken = token;
                            let saveTargetLabel = token ? "自定义回图文件夹" : "image_cache";
                            if (token) {
                                folder = await fs.getEntryForPersistentToken(token);
                                saveTargetLabel = folder?.name ? `自定义回图文件夹 ${folder.name}` : "自定义回图文件夹";
                            }
                            if (!folder) {
                                folder = await getTempResultFolder();
                                placeToken = folder?.token ?? null;
                                saveTargetLabel = folder?.name || "image_cache";
                            }
                            if (folder && placeToken) {
                                const savedFileNames = [];
                                const duckDecodeResults = [];
                                const setDuckStatus = (msg, duration = 5000) => {
                                    pushStatus(msg, duration);
                                    updateRun({ message: msg, stageText: msg, progress: 100 });
                                };
                                if (isDuckDecodeEnabledNow()) {
                                    pushStatus("小黄鸭解码开关已开启，准备解码", 0);
                                }
                                if (isDuckDecodeEnabledNow()) {
                                    setDuckStatus("小黄鸭解码开关已开启，准备解码", 0);
                                }
                                for (let i = 0; i < urls.length; i++) {
                                    const duckDecodeOn = isDuckDecodeEnabledNow();
                                    const { fileName, duckDecode } = await saveImageWithBounds(folder, urls[i], i + 1, {
                                        bounds: bounds ?? null,
                                        docId: docId ?? null,
                                        runningHubAppName: resolvedSnap.appMetaName,
                                        duckDecodeEnabled: duckDecodeOn,
                                        onDownloadProgress: (evt) => {
                                            if (evt?.domain !== "duckDecode") return;
                                            if (evt.phase === "start") {
                                                setDuckStatus("小黄鸭解码中", 0);
                                                return;
                                            }
                                            if (evt.phase === "success") {
                                                setDuckStatus("小黄鸭解码成功", 5000);
                                                return;
                                            }
                                            if (evt.phase === "failed") {
                                                const ex = evt.extra || {};
                                                const reason = ex.reason ? String(ex.reason) : "decode_failed";
                                                const errText = ex.error ? ` / ${String(ex.error).slice(0, 160)}` : "";
                                                const src = ex.sourceExt ? `.${String(ex.sourceExt)}` : "";
                                                const ct = ex.contentType ? ` / ${String(ex.contentType)}` : "";
                                                setDuckStatus(`小黄鸭解码失败${src}${ct}：${reason}${errText}，已回传原图`, 15000);
                                                return;
                                            }
                                            if (evt.phase === "success") pushStatus("小黄鸭解码成功", 5000);
                                            else if (evt.phase === "failed") {
                                                const ex = evt.extra || {};
                                                const reason = ex.reason ? String(ex.reason) : "decode_failed";
                                                const src = ex.sourceExt ? `.${String(ex.sourceExt)}` : "";
                                                const ct = ex.contentType ? ` / ${String(ex.contentType)}` : "";
                                                pushStatus(`小黄鸭解码失败${src}${ct}：${reason}，已回传原图`, 7000);
                                            }
                                            else if (evt.phase === "start") pushStatus("小黄鸭解码中", 0);
                                        },
                                    });
                                    if (duckDecodeOn) {
                                        duckDecodeResults.push(duckDecode || { ok: false, reason: "no_decode_result" });
                                        if (duckDecode?.ok) {
                                            setDuckStatus("小黄鸭解码成功", 5000);
                                        } else {
                                            const reasonForStatus = duckDecode?.reason ? String(duckDecode.reason) : "no_decode_result";
                                            const errTextForStatus = duckDecode?.error ? ` / ${String(duckDecode.error).slice(0, 160)}` : "";
                                            const srcForStatus = duckDecode?.sourceExt ? `.${String(duckDecode.sourceExt)}` : "";
                                            const ctForStatus = duckDecode?.contentType ? ` / ${String(duckDecode.contentType)}` : "";
                                            setDuckStatus(`小黄鸭解码失败${srcForStatus}${ctForStatus}：${reasonForStatus}${errTextForStatus}，已回传原图`, 15000);
                                        }
                                        if (duckDecode?.ok) {
                                            pushStatus("小黄鸭解码成功", 5000);
                                        } else {
                                            const reason = duckDecode?.reason ? String(duckDecode.reason) : "no_decode_result";
                                            const src = duckDecode?.sourceExt ? `.${String(duckDecode.sourceExt)}` : "";
                                            const ct = duckDecode?.contentType ? ` / ${String(duckDecode.contentType)}` : "";
                                            pushStatus(`小黄鸭解码失败${src}${ct}：${reason}，已回传原图`, 7000);
                                        }
                                    }
                                    savedFileNames.push(fileName);
                                }
                                saved = urls.length;
                                if (resultRefreshRef.current?.refresh) {
                                    await resultRefreshRef.current.refresh();
                                }
                                if (placeToken) {
                                    notifyResultFilesChanged({ folderToken: placeToken });
                                }
                                successMsg = token
                                    ? `完成 · 已保存 ${urls.length} 张到${saveTargetLabel}`
                                    : `完成 · 已保存 ${urls.length} 张到${saveTargetLabel}`;
                                if (duckDecodeResults.length > 0) {
                                    const okCountForFinal = duckDecodeResults.filter((r) => r?.ok).length;
                                    const firstFailForFinal = duckDecodeResults.find((r) => !r?.ok);
                                    const firstFailErrForFinal = firstFailForFinal?.error ? ` / ${String(firstFailForFinal.error).slice(0, 160)}` : "";
                                    const firstFailSourceForFinal = [
                                        firstFailForFinal?.sourceExt ? `.${String(firstFailForFinal.sourceExt)}` : "",
                                        firstFailForFinal?.contentType ? String(firstFailForFinal.contentType) : "",
                                        firstFailForFinal?.width && firstFailForFinal?.height
                                            ? `${firstFailForFinal.width}x${firstFailForFinal.height}`
                                            : "",
                                    ].filter(Boolean).join(" / ");
                                    const firstFailSourceTextForFinal = firstFailSourceForFinal ? `（${firstFailSourceForFinal}）` : "";
                                    const duckFinalMsg = okCountForFinal > 0
                                        ? `小黄鸭解码成功 ${okCountForFinal}/${urls.length}`
                                        : `小黄鸭解码失败${firstFailSourceTextForFinal}：${firstFailForFinal?.reason || "no_decode_result"}${firstFailErrForFinal}，已回传原图`;
                                    successMsg = `${successMsg} · ${duckFinalMsg}`;
                                    setDuckStatus(duckFinalMsg, 15000);
                                }
                                const placeGroupName = resolvedSnap.appMetaName
                                    ? `${resolvedSnap.appMetaName} 生成`
                                    : "RunningHub 生成";
                                const autoReturnOn = readAutoReturnEnabled(autoReturnEnabled !== false && autoReturnEnabled !== "false");
                                if (!autoReturnOn) {
                                    successMsg = `${successMsg} · 自动回传已关闭，等待手动贴回`;
                                }
                                pushStatus(successMsg, duckDecodeResults.length > 0 ? 15000 : (autoReturnOn ? 5000 : 7000));
                                if (!autoReturnOn) {
                                    updateRun({
                                        placeStatus: "pending",
                                        placeError: "自动回传已关闭",
                                        placeSavedFileNames: savedFileNames,
                                        placeBounds: bounds,
                                        placeToken,
                                        placeDocId: docId,
                                        placeGroupName,
                                    });
                                    pushStatus("图片已保存，自动回传已关闭，请在任务队列手动贴回", 7000);
                                } else {
                                    try {
                                        await enqueueRhAutoPlace(savedFileNames, placeGroupName, bounds, placeToken, docId);
                                        // 贴回成功，标记状态
                                        updateRun({ placeStatus: "placed" });
                                    } catch (e) {
                                        console.warn("[RhAutoPlace] 自动贴回失败:", e);
                                        // 判断是否可重试
                                        const canRetry = e && typeof e === "object" && e.canRetry === true;
                                        const reason = e && typeof e === "object" && e.reason ? String(e.reason) : String(e);
                                        if (canRetry) {
                                            // PS 处于特殊状态，标记为待返回
                                            updateRun({
                                                placeStatus: "pending",
                                                placeError: reason,
                                                placeSavedFileNames: savedFileNames,
                                                placeBounds: bounds,
                                                placeToken,
                                                placeDocId: docId,
                                                placeGroupName,
                                            });
                                            pushStatus("图片已保存，但当前无法贴回（待返回）", 5000);
                                        } else {
                                            // 其他错误，不可重试
                                            updateRun({ placeStatus: "failed", placeError: reason });
                                        }
                                    }
                                }
                            } else {
                                successMsg = `完成 · ${urls.length} 个输出（无法写入临时目录）`;
                                pushStatus(successMsg, 5000);
                            }
                        } catch (saveErr) {
                            const m =
                                saveErr && typeof saveErr === "object" && "message" in saveErr
                                    ? String(saveErr.message)
                                    : String(saveErr);
                            successMsg = `完成但保存失败: ${m}`;
                            pushStatus(successMsg, 6000);
                        }
                    } else {
                        successMsg = "完成";
                        pushStatus(successMsg, 5000);
                    }
                    const elapsedFinal = (Date.now() - startTime) / 1000;
                    let accountAfter = null;
                    try {
                        accountAfter = await rhFetchAccountStatus(RH_DEFAULT_BASE_URL, resolvedSnap.apiKeyTrim, {
                            timeoutMs: 6000,
                        });
                    } catch (_) {
                        accountAfter = null;
                    }
                    const baseline =
                        rhAccountCostBaselineRef.current?.apiKey === resolvedSnap.apiKeyTrim &&
                        rhAccountCostBaselineRef.current?.account
                            ? rhAccountCostBaselineRef.current.account
                            : accountBefore;
                    const secondaryMessage = buildRhSuccessSecondaryLine(elapsedFinal, baseline || accountBefore, accountAfter);
                    const costMessage = buildRhCostLine(baseline || accountBefore, accountAfter);
                    if (accountAfter) {
                        rhAccountCostBaselineRef.current = {
                            apiKey: resolvedSnap.apiKeyTrim,
                            account: accountAfter,
                        };
                    }
                    const displaySuccessMsg = buildRhSuccessDisplayMessage(urls, successMsg);
                    if (typeof onRefreshAccount === "function") {
                        try {
                            onRefreshAccount();
                        } catch (_) {
                            /* ignore */
                        }
                    }
                    return {
                        cancelled: false,
                        saved,
                        message: displaySuccessMsg,
                        errors: res.nodeErrors || [],
                        resultDetail: {
                            message: displaySuccessMsg,
                            secondaryMessage,
                            cost: costMessage,
                            time: `${elapsedFinal.toFixed(1)}s`,
                            saved: urls.length,
                        },
                    };
                }
                setNodeErrors(res.nodeErrors || []);
                const failedMessage = formatRhError(res || {});
                const permissionDenied = res.permissionDenied || isRhPermissionError(res);
                if (permissionDenied) {
                    setRunError(failedMessage);
                    pushStatus(failedMessage, 8000);
                }
                return {
                    cancelled: false,
                    saved: 0,
                    message: failedMessage || res.message || "任务失败",
                    errors: res.nodeErrors || [],
                    failed: true,
                    permissionDenied,
                };
            };

            const elapsedNow = () => (Date.now() - startTime) / 1000;

            const sub = await runOneResolved(/** @type {RhRunSnapshot} */ (snapshot));
            if (sub.cancelled) {
                return { status: "cancelled", resultDetail: { message: "已取消" }, elapsedSec: elapsedNow() };
            }
            if (sub.failed) {
                return {
                    status: "error",
                    resultDetail: { message: sub.message, errors: sub.errors || [] },
                    elapsedSec: elapsedNow(),
                };
            }
            return {
                status: "success",
                resultDetail: sub.resultDetail || {
                    message: sub.message,
                    saved: sub.saved,
                    time: `${elapsedNow().toFixed(1)}s`,
                },
                elapsedSec: elapsedNow(),
            };
        },
        [pushStatus, setTaskIdLast, setNodeErrors, setRunError, resultRefreshRef, rhAccountCostBaselineRef, autoReturnEnabled, onRefreshAccount, isDuckDecodeEnabledNow, enqueueRhAutoPlace]
    );
}

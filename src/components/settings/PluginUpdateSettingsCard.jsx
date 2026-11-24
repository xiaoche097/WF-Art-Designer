import React, { useRef, useState } from "react";
import { fetchProxy, invoke, isInWebView } from "../../bridge/uxpBridge.js";
import { PLUGIN_VERSION } from "../../pluginMeta.js";
import { comparePluginVersions, getInstalledPluginRelease, getLatestPluginRelease, PLUGIN_RELEASES_PAGE } from "../../utils/pluginReleases.js";
import { SettingsCard } from "./SettingsCard.jsx";

export function PluginUpdateSettingsCard() {
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const [download, setDownload] = useState(null);
    const lock = useRef(false);
    const inPhotoshop = isInWebView();

    async function requestUpdate(operation, selectedRelease) {
        if (lock.current) return;
        lock.current = true;
        setBusy(operation);
        setMessage("");
        if (!selectedRelease) setDownload(null);
        try {
            if (selectedRelease) {
                await openDownload(selectedRelease);
                return;
            }
            const reinstall = operation === "reinstall";
            const release = reinstall
                ? await getInstalledPluginRelease(PLUGIN_VERSION, fetchProxy)
                : await getLatestPluginRelease(fetchProxy);
            if (!release) {
                setMessage(reinstall ? `GitHub 尚未发布当前版本 v${PLUGIN_VERSION}。` : "GitHub 尚未提供可查询的稳定版。");
                return;
            }
            const comparison = comparePluginVersions(release.version, PLUGIN_VERSION);
            const version = `v${release.version}`;
            if (!reinstall && inPhotoshop && comparison < 0) {
                setMessage(`GitHub 最新发布版 ${version} 低于当前版本。`);
                return;
            }
            if (operation === "check" && comparison <= 0) {
                setMessage(comparison === 0 ? "当前已是最新版本。" : `GitHub 最新发布版为 ${version}。`);
                return;
            }
            if (!release.installerUrl) {
                setMessage(`${version} 已发布，Windows 安装包尚未附上。`);
                return;
            }
            setDownload(release);
            setMessage(operation === "check" ? `发现新版本 ${version}。` : `已找到 ${version} 的 Windows 安装包。`);
            if (operation !== "check") await openDownload(release);
        } catch (error) {
            setMessage(error.message || "操作失败，请稍后重试。");
        } finally {
            lock.current = false;
            setBusy("");
        }
    }

    async function openDownload(release) {
        if (!inPhotoshop) return;
        await invoke("pluginUpdate.openInstallerDownload", release.tag);
        setMessage(`已打开 ${release.version} 的下载。请运行下载的 EXE，安装后重启 Photoshop。`);
    }

    return (
        <SettingsCard cardClass="rh-config-card wfa-plugin-update" title="插件与更新">
            <div className="wfa-plugin-update-body">
                <span>当前{inPhotoshop ? "插件" : "预览"}版本 v{PLUGIN_VERSION}</span>
                <div className="wfa-plugin-update-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => requestUpdate("check")}>
                        {busy === "check" ? "检测中…" : "检测更新"}
                    </button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => requestUpdate("install")}>
                        {busy === "install" ? "查询中…" : "安装插件"}
                    </button>
                    <button type="button" disabled={Boolean(busy) || !inPhotoshop} onClick={() => requestUpdate("reinstall")}>
                        {busy === "reinstall" ? "查询中…" : "重新安装插件"}
                    </button>
                </div>
                {message && <p role="status">{message}</p>}
                {download && (inPhotoshop
                    ? <button type="button" disabled={Boolean(busy)} onClick={() => requestUpdate("download", download)}>下载 v{download.version} 安装包</button>
                    : <a href={download.installerUrl} target="_blank" rel="noopener noreferrer">下载 v{download.version} 安装包</a>)}
                {!inPhotoshop && <a href={PLUGIN_RELEASES_PAGE} target="_blank" rel="noopener noreferrer">GitHub Releases</a>}
            </div>
        </SettingsCard>
    );
}

const REPOSITORY = "xiaoche097/WF-Art-Designer";
const RELEASES_PATH = `/${REPOSITORY}/releases`;
const RELEASES_API = `https://api.github.com/repos${RELEASES_PATH}`;
export const PLUGIN_RELEASES_PAGE = `https://github.com${RELEASES_PATH}`;
const RELEASE_VERSION = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
let requestSequence = 0;

export function comparePluginVersions(a, b) {
    const left = RELEASE_VERSION.exec(a);
    const right = RELEASE_VERSION.exec(b);
    if (!left || !right) throw new Error("插件版本号格式不正确");
    for (let i = 1; i <= 3; i++) {
        const difference = Number(left[i]) - Number(right[i]);
        if (difference) return Math.sign(difference);
    }
    return 0;
}

export function pluginInstallerUrl(tag) {
    if (typeof tag !== "string" || !RELEASE_VERSION.test(tag)) throw new Error("发布标签必须是稳定版本号");
    const version = tag.replace(/^v/, "");
    return `${PLUGIN_RELEASES_PAGE}/download/${tag}/WfArtAssistant-${version}-Installer.exe`;
}

async function getRelease(endpoint, request) {
    // A new URL keeps both the WebView and host transport from reusing cached metadata.
    const check = `${Date.now()}-${++requestSequence}`;
    const response = await request(`${RELEASES_API}/${endpoint}?wf_check=${check}`, {
        headers: { Accept: "application/vnd.github+json" },
        timeoutMs: 12000,
        hostTimeoutBufferMs: 0,
    });
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) throw new Error("GitHub 暂时限制了请求，请稍后重试");
    if (!response.ok) throw new Error(`GitHub 查询失败（HTTP ${response.status}）`);
    const release = JSON.parse(response.body);
    const tag = release.tag_name;
    if (release.draft || release.prerelease || typeof tag !== "string" || !RELEASE_VERSION.test(tag)) {
        throw new Error("GitHub Release 缺少有效的稳定版本标签");
    }
    const url = pluginInstallerUrl(tag);
    const installer = Array.isArray(release.assets) && release.assets.find(asset =>
        asset.state === "uploaded" && asset.size > 0 && asset.browser_download_url === url &&
        asset.name === url.slice(url.lastIndexOf("/") + 1));
    return { tag, version: tag.replace(/^v/, ""), installerUrl: installer ? url : null };
}

export function getLatestPluginRelease(request) {
    return getRelease("latest", request);
}

export async function getInstalledPluginRelease(version, request) {
    const stable = version.replace(/^v/, "");
    if (!RELEASE_VERSION.test(stable)) throw new Error("当前插件版本号格式不正确");
    const release = await getRelease(`tags/v${stable}`, request);
    const match = release?.installerUrl ? release : await getRelease(`tags/${stable}`, request) || release;
    if (match && comparePluginVersions(match.version, stable) !== 0) throw new Error("GitHub 返回的版本与当前插件版本不符");
    return match;
}

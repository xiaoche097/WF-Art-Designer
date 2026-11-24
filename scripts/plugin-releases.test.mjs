import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePluginVersions, getInstalledPluginRelease, getLatestPluginRelease, pluginInstallerUrl } from "../src/utils/pluginReleases.js";

function release(tag) {
    const url = pluginInstallerUrl(tag);
    return {
        tag_name: tag,
        assets: [{ name: url.split("/").at(-1), state: "uploaded", size: 123, browser_download_url: url }],
    };
}

function response(body, status = 200) {
    return { body: JSON.stringify(body), status, ok: status === 200 };
}

test("successive checks fetch fresh GitHub metadata and see the latest published version", async () => {
    const urls = [];
    const request = async (url) => {
        urls.push(url);
        return response(release(urls.length === 1 ? "v2.3.3" : "v2.10.0"));
    };
    const first = await getLatestPluginRelease(request);
    const second = await getLatestPluginRelease(request);
    assert.equal(comparePluginVersions(second.version, first.version), 1);
    assert.notEqual(urls[0], urls[1]);
    assert.ok(urls.every(url => /^https:\/\/api\.github\.com\/repos\/xiaoche097\/WF-Art-Designer\/releases\/latest\?wf_check=/.test(url)));
});

test("invalid and missing release assets cannot produce an installation link", async () => {
    assert.equal(await getLatestPluginRelease(async () => response({}, 404)), null);
    await assert.rejects(getLatestPluginRelease(async () => response({}, 429)), /限制/);
    await assert.rejects(getLatestPluginRelease(async () => response({ ...release("v2.3.3"), prerelease: true })), /稳定版/);
    const bad = release("v2.3.3");
    bad.assets[0].browser_download_url = "https://example.com/Installer.exe";
    assert.equal((await getLatestPluginRelease(async () => response(bad))).installerUrl, null);
});

test("reinstall uses the installed version instead of the latest release", async () => {
    const paths = [];
    const result = await getInstalledPluginRelease("2.3.2", async (url) => {
        paths.push(new URL(url).pathname);
        return paths.length === 1 ? response({}, 404) : response(release("2.3.2"));
    });
    assert.equal(result.installerUrl, pluginInstallerUrl("2.3.2"));
    assert.deepEqual(paths, [
        "/repos/xiaoche097/WF-Art-Designer/releases/tags/v2.3.2",
        "/repos/xiaoche097/WF-Art-Designer/releases/tags/2.3.2",
    ]);
});

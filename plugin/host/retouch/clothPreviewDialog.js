const { getPreview, validateSettings } = require("./clothHost");
const { storage } = require("uxp");

async function showClothPreview(args) {
    const payload = getPreview(args);
    const fs = storage.localFileSystem;
    const { utf8 } = storage.formats;
    const plugin = await fs.getPluginFolder();
    const temp = await fs.getTemporaryFolder();
    const nonce = `cloth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const template = await (await plugin.getEntry("cloth-preview.html")).read({ format: utf8 });
    const script = await (await plugin.getEntry("cloth-preview.js")).read({ format: utf8 });
    const placeholder = '<script src="./cloth-preview.js"></script>';
    if (!template.includes(placeholder)) throw Error("安装包缺少大图预览入口");
    const dataJson = JSON.stringify({ ...payload, nonce }).replace(/</g, "\\u003c");
    const entry = await temp.createFile(nonce + ".html");
    try {
        // The window can render even when Windows drops the first WebView message.
        const html = template.replace(placeholder, () =>
            `<script id="cloth-data" type="application/json">${dataJson}</script><script>${script.replace(/<\/script/gi, "<\\/script")}</script>`);
        await entry.write(html, { format: utf8 });
        return await showWindow(nonce, entry.name);
    } finally {
        await entry.delete().catch(error => console.warn("Unable to clear clothing preview", error));
    }
}

async function showWindow(nonce, name) {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "padding:0;margin:0;width:100%;height:100%;min-width:0;min-height:0;";
    const view = document.createElement("webview");
    view.style.cssText = "width:100%;height:100%;display:block;border:0;";
    let response = null;
    let closing = false;
    const onMessage = ({ data }) => {
        if (closing || data?.nonce !== nonce) return;
        if (data.type === "clothPreview.cancel") {
            closing = true;
            dialog.close("cancel");
        } else if (data?.type === "clothPreview.confirm") {
            try {
                response = validateSettings(data.settings);
                closing = true;
                dialog.close("confirm");
            } catch (error) {
                view.postMessage({ type: "clothPreview.error", message: error.message });
            }
        }
    };
    window.addEventListener("message", onMessage);
    view.addEventListener("message", onMessage);
    view.setAttribute("src", "plugin-temp:/" + name);
    dialog.appendChild(view);
    document.body.appendChild(dialog);
    try {
        const width = Math.max(640, Math.min(1140, (window.screen?.availWidth || 1320) - 100));
        const height = Math.max(480, Math.min(820, (window.screen?.availHeight || 930) - 90));
        const outcome = await dialog.uxpShowModal({
            title: "衣物美化预览", resize: "both", size: { width, height },
            minSize: { width: 540, height: 420 },
        });
        return outcome === "confirm" ? response : null;
    } finally {
        window.removeEventListener("message", onMessage);
        view.removeEventListener("message", onMessage);
        dialog.remove();
    }
}

module.exports = { showClothPreview };

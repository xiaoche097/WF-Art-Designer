import { PS_SCRIPTS } from "../../src/ps-tools/catalog.js";

const { app, action, core } = require("photoshop");
const { localFileSystem } = require("uxp").storage;
let running = false;

export async function runPsScript({ id } = {}) {
    const script = PS_SCRIPTS.find(entry => entry.id === id);
    if (!script) throw Error("找不到所选 Photoshop 脚本。");
    if (running) throw Error("请先完成当前脚本。");
    if (!app.documents.length) throw Error("请先打开 Photoshop 文档并选中图层组。");

    running = true;
    try {
        const documentId = app.activeDocument.id;
        const plugin = await localFileSystem.getPluginFolder();
        const scripts = await plugin.getEntry("ps-scripts");
        const file = await scripts.getEntry(script.id + ".jsx");
        const token = localFileSystem.createSessionToken(file);
        return await core.executeAsModal(async context => {
            if (!app.documents.length || app.activeDocument.id !== documentId) {
                throw Error("当前 Photoshop 文档已切换，请确认后重试。");
            }
            const [result] = await action.batchPlay([{
                _obj: "AdobeScriptAutomation Scripts",
                javaScript: { _kind: "local", _path: token },
                javaScriptMessage: "JSM",
                _options: { dialogOptions: "dontDisplay" },
            }], {});
            if (context.isCancelled || result?.result === -128) return { cancelled: true };
            if (result?._obj === "error") throw Error(result.message || "Photoshop 无法运行此脚本。");
            return { cancelled: false };
        }, { commandName: script.name, interactive: true });
    } finally {
        running = false;
    }
}

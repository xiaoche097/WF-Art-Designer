const { getPreview, validateSettings } = require("./clothHost");

async function showClothPreview(args) {
    const payload = getPreview(args);
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "padding:0;margin:0;width:100%;height:100%;min-width:0;min-height:0;";
    const view = document.createElement("webview");
    view.style.cssText = "width:100%;height:100%;display:block;border:0;";
    let response = null;
    const onMessage = ({ data }) => {
        if (data?.type === "clothPreview.ready") {
            view.postMessage({ type: "clothPreview.data", payload });
        } else if (data?.type === "clothPreview.cancel") {
            dialog.close("cancel");
        } else if (data?.type === "clothPreview.confirm") {
            try {
                response = validateSettings(data.settings);
                dialog.close("confirm");
            } catch (error) {
                view.postMessage({ type: "clothPreview.error", message: error.message });
            }
        }
    };
    view.addEventListener("message", onMessage);
    view.setAttribute("src", "plugin:/cloth-preview.html");
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
        view.removeEventListener("message", onMessage);
        dialog.remove();
    }
}

module.exports = { showClothPreview };

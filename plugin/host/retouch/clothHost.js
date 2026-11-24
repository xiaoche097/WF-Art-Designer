const { app, action, core, imaging, constants } = require("photoshop");
const { constrainMask, resizeMask } = require("./clothComposite");
const { toBase64 } = require("./retouchHost");

const PROFILE = "sRGB IEC61966-2.1";
const ENGINE_URL = "http://127.0.0.1:49321";
const MAX_PIXELS = 12000000;
const MAX_PREVIEW_EDGE = 640;
let current;
let sequence = 0;

function requireDocument() {
    const doc = app.documents.length ? app.activeDocument : null;
    if (!doc) throw Error("请先打开 Photoshop 文档");
    if (doc.quickMaskMode) throw Error("请退出快速蒙版模式后继续");
    return doc;
}

function documentFormat(doc) {
    const { RGB, CMYK, LAB, GRAYSCALE, INDEXEDCOLOR } = constants.DocumentMode;
    const { EIGHT, SIXTEEN, THIRTYTWO } = constants.BitsPerChannelType;
    const mode = doc.mode;
    const bits = doc.bitsPerChannel;
    const profile = doc.colorProfileName;
    const depth = bits === EIGHT ? 8 : bits === SIXTEEN ? 16 : bits === THIRTYTWO ? 32 : bits === constants.BitsPerChannelType.ONE ? 1 : null;
    const modeLabel = new Map([[RGB, "RGB"], [CMYK, "CMYK"], [LAB, "Lab"], [GRAYSCALE, "灰度"], [INDEXEDCOLOR, "索引颜色"]]).get(mode);
    return {
        mode: modeLabel ?? "其他模式",
        depth,
        profile: profile && profile !== "None" ? profile : "无色彩配置",
        ready: mode === RGB && bits === EIGHT && profile === PROFILE,
        canConvert: Boolean(modeLabel) && (bits === EIGHT || bits === SIXTEEN),
    };
}

function requireCurrent(id) {
    if (!current || id !== current.id) throw Error("衣物任务已失效，请重新读取");
    const doc = requireDocument();
    if (doc.id !== current.docId || doc.activeHistoryState.id !== current.revision ||
        doc.width !== current.docWidth || doc.height !== current.docHeight) {
        throw Error("文档或历史状态已改变，请重新读取衣物");
    }
    return { doc, source: current };
}

async function availableMasks(doc) {
    const groups = [];
    async function walk(layers, prefix) {
        for (const layer of layers) {
            const name = prefix ? `${prefix} / ${layer.name}` : layer.name;
            const [info] = await action.batchPlay([{ _obj: "get", _target: [
                { _ref: "layer", _id: layer.id }, { _ref: "document", _id: doc.id },
            ] }], {});
            if (info?._obj === "error") throw Error(info.message || "无法读取图层蒙版");
            if (info?.hasUserMask && info.userMaskEnabled !== false) groups.push({ id: layer.id, name });
            if (layer.kind === constants.LayerKind.GROUP) await walk(layer.layers, name);
        }
    }
    await walk(doc.layers, "");
    return groups;
}

async function describeDocument(doc) {
    const format = documentFormat(doc);
    return { docId: doc.id, title: doc.title, format, width: doc.width, height: doc.height,
        masks: format.ready ? await availableMasks(doc) : [], hasSelection: Boolean(doc.selection.bounds) };
}

async function inspect() {
    return describeDocument(requireDocument());
}

async function prepareCopy({ docId } = {}) {
    return core.executeAsModal(async () => {
        const doc = requireDocument();
        if (doc.id !== docId) throw Error("当前 Photoshop 文档已切换，请重新扫描");
        const format = documentFormat(doc);
        if (format.ready) return describeDocument(doc);
        if (!format.canConvert) throw Error("请在 Photoshop 中将文档副本转换为 8 位 RGB，再转为 sRGB");
        const selectionBounds = doc.selection.bounds;
        const region = selectionBounds ? captureRegion(doc, selectionBounds) : null;
        const selection = region ? await readRegion(await imaging.getSelection({
            documentID: doc.id, sourceBounds: region.bounds,
        }), region.bounds, 1) : null;
        const copy = await doc.duplicate(`${doc.title} · 衣物美化副本`, false);
        try {
            if (copy.mode !== constants.DocumentMode.RGB) await copy.changeMode(constants.ChangeMode.RGB);
            if (copy.bitsPerChannel !== constants.BitsPerChannelType.EIGHT) copy.bitsPerChannel = constants.BitsPerChannelType.EIGHT;
            if (copy.colorProfileName !== PROFILE) await copy.convertProfile(PROFILE, constants.Intent.RELATIVECOLORIMETRIC, true, false);
            if (selection) {
                const { width, height, bounds: { left, top } } = region;
                const imageData = await imaging.createImageDataFromBuffer(selection, { width, height, components: 1, colorSpace: "Grayscale" });
                try {
                    await imaging.putSelection({ documentID: copy.id, imageData, targetBounds: { left, top }, replace: true });
                } finally {
                    imageData.dispose();
                }
            }
            const result = await describeDocument(copy);
            if (!result.format.ready) throw Error("Photoshop 未能生成 8 位 sRGB 副本");
            current = null;
            return result;
        } catch (error) {
            await copy.closeWithoutSaving();
            throw error;
        }
    }, { commandName: "衣物美化：创建 8 位 sRGB 副本" });
}

async function readRegion(response, bounds, channels) {
    const { imageData, sourceBounds } = response;
    if (!imageData) throw Error("Photoshop 没有返回像素");
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    try {
        const { width: rw, height: rh, components } = imageData;
        if (!sourceBounds || !["left", "top", "right", "bottom"].every(key => Number.isInteger(sourceBounds[key])) ||
            sourceBounds.left < bounds.left || sourceBounds.top < bounds.top ||
            sourceBounds.right > bounds.right || sourceBounds.bottom > bounds.bottom ||
            rw !== sourceBounds.right - sourceBounds.left || rh !== sourceBounds.bottom - sourceBounds.top ||
            (channels === 1 ? components !== 1 : components !== 3 && components !== 4)) {
            throw Error("Photoshop 返回的范围或通道不符合预期");
        }
        const data = await imageData.getData({ chunky: true, fullRange: true });
        if (data.length !== rw * rh * components) throw Error("Photoshop 像素数据不完整");
        const max = imageData.componentSize === 16 ? 65535 : imageData.componentSize === 32 ? 1 : 255;
        if (channels === 4 && max !== 255) throw Error("Photoshop 没有返回 8 位 RGB 通道");
        const result = new Uint8Array(width * height * channels);
        for (let y = 0; y < rh; y++) {
            let dest = ((sourceBounds.top - bounds.top + y) * width + sourceBounds.left - bounds.left) * channels;
            for (let x = 0; x < rw; x++, dest += channels) {
                const i = (y * rw + x) * components;
                if (channels === 1) result[dest] = Math.round(Math.min(1, Math.max(0, data[i] / max)) * 255);
                else {
                    result[dest] = data[i];
                    result[dest + 1] = data[i + 1];
                    result[dest + 2] = data[i + 2];
                    result[dest + 3] = components === 4 ? data[i + 3] : 255;
                }
            }
        }
        return result;
    } finally {
        imageData.dispose();
    }
}

function rgbaTile(source, x, y, width, height) {
    const bytes = new Uint8Array(width * height * 4);
    for (let v = 0; v < height; v++) {
        const start = ((y + v) * source.width + x) * 4;
        bytes.set(source.rgba.subarray(start, start + width * 4), v * width * 4);
    }
    return toBase64(bytes);
}

function makePreview(rgba, width, height) {
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const bytes = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const src = (Math.floor((y + .5) * height / h) * width + Math.floor((x + .5) * width / w)) * 4;
            bytes.set(rgba.subarray(src, src + 4), (y * w + x) * 4);
        }
    }
    return { w, h, bytes };
}

function captureRegion(doc, input) {
    const bounds = {
        left: Math.max(0, Math.floor(input?.left ?? 0)), top: Math.max(0, Math.floor(input?.top ?? 0)),
        right: Math.min(doc.width, Math.ceil(input?.right ?? doc.width)),
        bottom: Math.min(doc.height, Math.ceil(input?.bottom ?? doc.height)),
    };
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (Math.min(width, height) < 8 || width * height > MAX_PIXELS || Math.max(width, height) > 8192) {
        throw Error(`当前读取范围为 ${width} × ${height}。请用 Photoshop 选框圈住衣物区域，范围至少为 8 × 8，最多 1200 万像素且单边不超过 8192 像素。`);
    }
    return { bounds, width, height };
}

async function read({ docId, layerId } = {}) {
    current = null;
    return core.executeAsModal(async () => {
        const doc = requireDocument();
        if (doc.id !== docId) throw Error("当前 Photoshop 文档已切换，请重新扫描");
        if (!documentFormat(doc).ready) throw Error("请先在面板中创建 8 位 sRGB 副本");
        const revision = doc.activeHistoryState?.id;
        if (!Number.isInteger(revision)) throw Error("无法确认 Photoshop 历史状态");
        if (layerId != null && !(await availableMasks(doc)).some(entry => entry.id === layerId)) {
            throw Error("所选 Photoshop 像素蒙版已移除或停用");
        }
        const input = doc.selection.bounds;
        const { bounds, width, height } = captureRegion(doc, input);
        const args = { documentID: doc.id, sourceBounds: bounds };
        const rgba = await readRegion(await imaging.getPixels({ ...args, componentSize: 8,
            colorSpace: "RGB", colorProfile: PROFILE, applyAlpha: false }), bounds, 4);
        const constraints = [];
        if (input) constraints.push(await readRegion(await imaging.getSelection(args), bounds, 1));
        if (layerId != null) constraints.push(await readRegion(await imaging.getLayerMask({ ...args, layerID: layerId, kind: "user" }), bounds, 1));
        const limit = constrainMask(new Uint8Array(width * height).fill(255), rgba, constraints);
        if (!limit.some(Boolean)) throw Error("选区、蒙版与可见图像没有交集");
        const preview = makePreview(rgba, width, height);
        current = { id: ++sequence, docId, docWidth: doc.width, docHeight: doc.height, revision,
            bounds, width, height, rgba, preview, limit, hasMask: constraints.length > 0 };
        return { id: current.id, title: doc.title, width, height, previewWidth: preview.w, previewHeight: preview.h,
            rgba: toBase64(preview.bytes), constraint: toBase64(resizeMask(limit, width, height, preview.w, preview.h)),
            hasMask: current.hasMask, bounds, profile: PROFILE, depth: 8 };
    }, { commandName: "衣物美化：读取原图与蒙版" });
}

function sampleDetail({ id, x, y }) {
    const { source } = requireCurrent(id);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= source.width || y < 0 || y >= source.height) throw Error("检查位置无效");
    const width = Math.min(source.width, 480);
    const height = Math.min(source.height, 480);
    const left = Math.min(Math.max(0, x - Math.floor(width / 2)), source.width - width);
    const top = Math.min(Math.max(0, y - Math.floor(height / 2)), source.height - height);
    const constraint = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) {
        const start = (top + row) * source.width + left;
        constraint.set(source.limit.subarray(start, start + width), row * width);
    }
    return { left, top, width, height, rgba: rgbaTile(source, left, top, width, height), constraint: toBase64(constraint) };
}

function decodeMask(text, length) {
    if (typeof text !== "string" || text.length !== Math.ceil(length / 3) * 4) throw Error("衣物蒙版长度无效");
    const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
    if (bytes.length !== length) throw Error("衣物蒙版数据不完整");
    return bytes;
}

async function apply({ id, mask, fromPhotoshop }) {
    return core.executeAsModal(async ({ hostControl }) => {
        const { doc, source } = requireCurrent(id);
        const { rgba, width, height, bounds, limit, preview } = source;
        if (fromPhotoshop && !source.hasMask) throw Error("请先读取 Photoshop 像素蒙版或选区");
        const outputMask = fromPhotoshop && mask == null
            ? limit
            : constrainMask(resizeMask(decodeMask(mask, preview.w * preview.h), preview.w, preview.h, width, height), rgba, [limit]);
        if (!outputMask.some(Boolean)) throw Error("蒙版为空，没有可写入的区域");
        const history = await hostControl.suspendHistory({ documentID: doc.id, name: "衣物美化：写入分割副本" });
        let success = false, frame, gray;
        try {
            const top = doc.layers[0];
            const layer = await doc.createPixelLayer({ name: "衣物美化 · 分割副本" });
            if (top && doc.layers[0].id !== layer.id) await layer.move(top, constants.ElementPlacement.PLACEBEFORE);
            layer.visible = false;
            const targetBounds = { left: bounds.left, top: bounds.top };
            frame = await imaging.createImageDataFromBuffer(rgba, { width, height, components: 4,
                colorSpace: "RGB", colorProfile: PROFILE, chunky: true });
            await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: frame, targetBounds });
            gray = await imaging.createImageDataFromBuffer(outputMask, { width, height, components: 1, colorSpace: "Grayscale", chunky: false });
            await imaging.putLayerMask({ documentID: doc.id, layerID: layer.id, imageData: gray, kind: "user", replace: true, targetBounds });
            success = true;
            return { layerId: layer.id };
        } finally {
            try {
                frame?.dispose();
                gray?.dispose();
            } finally {
                await hostControl.resumeHistory(history, success);
                if (success) current = null;
            }
        }
    }, { commandName: "衣物美化：写入分割副本" });
}

async function segment({ id, token, points }) {
    const { source } = requireCurrent(id);
    const { w, h, bytes } = source.preview;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw Error("请填写本地 SAM 服务启动时显示的配对码");
    if (!Array.isArray(points) || points.length > 64 || !points.some(point => point?.positive === true) ||
        points.some(point => !Number.isInteger(point?.x) || point.x < 0 || point.x >= w ||
            !Number.isInteger(point.y) || point.y < 0 || point.y >= h || typeof point.positive !== "boolean")) {
        throw Error("请添加至少一个有效正点，正负点合计最多 64 个");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(`${ENGINE_URL}/v1/segment`, {
            method: "POST", signal: controller.signal, redirect: "error",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream",
                "X-Cloth-Request": JSON.stringify({ width: w, height: h, points }) },
            body: bytes.buffer,
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw Error(body?.error || `本地 SAM 服务返回 ${response.status}`);
        }
        const mask = new Uint8Array(await response.arrayBuffer());
        requireCurrent(id);
        const limit = resizeMask(source.limit, source.width, source.height, w, h);
        const constrained = constrainMask(mask, bytes, [limit]);
        if (!constrained.some(Boolean)) throw Error("本地分割与当前选区无交集，请调整正负点或使用 Photoshop 蒙版");
        return { mask: toBase64(constrained), confidence: Number(response.headers.get("X-Cloth-Score")) };
    } catch (error) {
        if (error.name === "AbortError") throw Error("本地 SAM 分割超时。可重试或使用 Photoshop 蒙版。");
        if (error instanceof TypeError) throw Error("未连接本地 SAM 服务。请启动服务，或直接使用 Photoshop 蒙版。");
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { inspect, prepareCopy, read, sampleDetail, apply, segment };

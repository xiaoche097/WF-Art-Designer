const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");
const { composite, constrainMask } = require("../plugin/host/retouch/clothComposite");
const { buildToneField, buildToneBands, combineToneBands, renderTone } = require("../plugin/host/retouch/clothTone");

test("clothing intensity lifts fold shadows without changing alpha or unmasked pixels", () => {
    const width = 160, height = 100;
    const mask = new Uint8Array(width * height);
    const rgba = new Uint8Array(mask.length * 4);
    for (let y = 0, p = 0; y < height; y++) {
        for (let x = 0; x < width; x++, p++) {
            const value = 175 - (Math.abs(x - 80) <= 2 ? 25 : 0) + (y % 2 ? 6 : 0);
            rgba.set([value + 15, value, value - 15, x === 60 ? 100 : 255], p * 4);
            if (x > 20 && x < 140) mask[p] = 255;
        }
    }
    const field = buildToneField(rgba, mask, width, height);
    const at = (x, y) => (y * width + x) * 4;
    const slight = renderTone(rgba, width, height, field, width, height, mask, 30);
    const strong = renderTone(rgba, width, height, field, width, height, mask, 100);
    assert.deepEqual(renderTone(rgba, width, height, field, width, height, mask, 0), rgba);
    assert.ok(strong[at(80, 48)] > slight[at(80, 48)]);
    assert.ok(slight[at(80, 48)] > rgba[at(80, 48)]);
    assert.ok(strong[at(80, 49)] - strong[at(80, 48)] >= 6);
    assert.equal(strong[at(80, 48)] - strong[at(80, 48) + 1], 15);
    const bands = buildToneBands(rgba, mask, width, height);
    const off = combineToneBands(bands, { fine: 0, coarse: 0 });
    const fineOnly = combineToneBands(bands, { fine: 100, coarse: 0 });
    const coarseOnly = combineToneBands(bands, { fine: 0, coarse: 100 });
    assert.ok(off.every(value => value === 0));
    assert.notDeepEqual(fineOnly, coarseOnly);
    assert.ok(fineOnly[48 * width + 79] > 0);
    const labels = Uint8Array.from(mask, (_, p) => p % width < 80 ? 1 : 2);
    const onlyUpper = combineToneBands(bands, { upper: 100, lower: 0, fine: 100, coarse: 100 }, labels);
    assert.ok(onlyUpper[48 * width + 79] > 0);
    assert.equal(onlyUpper[48 * width + 80], 0);
    for (let p = 0; p < mask.length; p++) {
        assert.equal(strong[p * 4 + 3], rgba[p * 4 + 3]);
        if (!mask[p] || rgba[p * 4 + 3] !== 255) {
            assert.deepEqual(strong.subarray(p * 4, p * 4 + 4), rgba.subarray(p * 4, p * 4 + 4));
        }
    }
});

test("P0 compositor preserves source alpha, hidden RGB and all unmasked bytes", () => {
    const original = Uint8Array.of(1, 2, 3, 255, 10, 20, 30, 117, 70, 80, 90, 0, 9, 8, 7, 250);
    const candidate = Uint8Array.of(201, 202, 203, 200, 110, 120, 130, 255, 170, 180, 190, 255, 199, 198, 197, 1);
    const result = composite(original, candidate, Uint8Array.of(0, 128, 255, 0));
    assert.deepEqual(result, Uint8Array.of(1, 2, 3, 255, 60, 70, 80, 117, 70, 80, 90, 0, 9, 8, 7, 250));
    assert.deepEqual(constrainMask(Uint8Array.of(255, 255, 255, 90), original, [
        Uint8Array.of(255, 127, 255, 0), Uint8Array.of(0, 128, 255, 255),
    ]), Uint8Array.of(0, 127, 0, 0));
});

test("P0/P1 bridge offsets, soft mask, result layer and stale snapshot guard", async () => {
    const resultLayers = [];
    const transactions = [];
    let writePixels, writeMask, failMask = false, failConversion = false, duplicateCount = 0, failedCopyClosed = false;
    const target = { id: 5, name: "服装", kind: "pixel", visible: true };
    const doc = {
        id: 10, title: "fixture", width: 28, height: 36, mode: "rgb", bitsPerChannel: 8,
        colorProfileName: "sRGB IEC61966-2.1", activeHistoryState: { id: 17 },
        selection: { bounds: { left: 3, top: 5, right: 11, bottom: 13 } }, layers: [target],
        async duplicate(title, merged) {
            assert.equal(merged, false);
            duplicateCount++;
            const copy = {
                ...this, title, id: 11, layers: [...this.layers], selection: { bounds: null },
                async changeMode(mode) { this.mode = mode; },
                async convertProfile(profile) {
                    if (failConversion) throw Error("conversion failure");
                    this.colorProfileName = profile;
                },
                closeWithoutSaving() { failedCopyClosed = true; mock.app.activeDocument = doc; },
            };
            mock.app.activeDocument = copy;
            return copy;
        },
        async createPixelLayer({ name }) {
            const layer = { id: 6 + resultLayers.length, name, visible: true };
            resultLayers.push(layer);
            this.layers.unshift(layer);
            return layer;
        },
    };
    const rgba = new Uint8Array(8 * 8 * 4).fill(120);
    rgba[3] = 0;
    const image = (data, components, bounds = doc.selection.bounds) => ({
        sourceBounds: bounds, imageData: {
            width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, components, componentSize: 8,
            async getData() { return data; }, dispose() {},
        },
    });
    const mock = {
        app: { activeDocument: doc, documents: [doc] },
        constants: {
            DocumentMode: { RGB: "rgb", CMYK: "cmyk", LAB: "lab", GRAYSCALE: "gray", INDEXEDCOLOR: "indexed" },
            BitsPerChannelType: { EIGHT: 8, SIXTEEN: 16, THIRTYTWO: 32 },
            ChangeMode: { RGB: "rgb" }, Intent: { RELATIVECOLORIMETRIC: "relative" },
            LayerKind: { GROUP: "group" }, ElementPlacement: { PLACEBEFORE: 1 },
        },
        action: { async batchPlay() { return [{ hasUserMask: true, userMaskEnabled: true }]; } },
        core: { async executeAsModal(task) { return task({ hostControl: {
            async suspendHistory() { return 4; },
            async resumeHistory(id, success) { transactions.push(success); },
        } }); } },
        imaging: {
            async getPixels(opts) { assert.equal(opts.applyAlpha, false); return image(rgba, 4); },
            async getSelection() { return image(new Uint8Array(64).fill(191), 1); },
            async putSelection({ documentID, imageData, targetBounds, replace }) {
                assert.equal(documentID, 11);
                assert.deepEqual(targetBounds, { left: 3, top: 5 });
                assert.equal(replace, true);
                assert.deepEqual(imageData.data, new Uint8Array(64).fill(191));
                mock.app.activeDocument.selection.bounds = { ...doc.selection.bounds };
            },
            async getLayerMask() { return image(new Uint8Array(16).fill(127), 1, { left: 5, top: 7, right: 9, bottom: 11 }); },
            async createImageDataFromBuffer(data) { return { data, dispose() {} }; },
            async putPixels(args) { writePixels = args; },
            async putLayerMask(args) { if (failMask) throw new Error("mask failure"); writeMask = args; },
        },
    };
    const load = Module._load;
    Module._load = function (name, ...args) { return name === "photoshop" ? mock : load.call(this, name, ...args); };
    let host;
    try { host = require("../plugin/host/retouch/clothHost"); }
    finally { Module._load = load; }
    assert.equal((await host.inspect()).masks.length, 1);
    const source = await host.read({ docId: 10, layerId: 5 });
    assert.deepEqual(Buffer.from(source.rgba, "base64"), Buffer.from(rgba));
    assert.equal(Buffer.from(source.constraint, "base64").filter(Boolean).length, 16);
    const detail = host.sampleDetail({ id: source.id, x: 4, y: 4 });
    assert.equal(Buffer.from(detail.constraint, "base64")[2 * 8 + 2], 127);
    doc.activeHistoryState.id++;
    await assert.rejects(host.apply({ id: source.id, fromPhotoshop: true }), /历史状态/);
    doc.activeHistoryState.id--;
    failMask = true;
    await assert.rejects(host.apply({ id: source.id, fromPhotoshop: true }), /mask failure/);
    failMask = false;
    await host.apply({ id: source.id, fromPhotoshop: true });
    assert.deepEqual(transactions, [false, true]);
    assert.deepEqual(writePixels.imageData.data, rgba);
    assert.equal(writeMask.imageData.data.filter(Boolean).length, 16);
    assert.deepEqual(writeMask.targetBounds, { left: 3, top: 5 });
    assert.ok(resultLayers.every(layer => layer.visible === false));
    assert.equal(target.visible, true);
    await assert.rejects(host.apply({ id: source.id, fromPhotoshop: true }), /已失效/);

    doc.bitsPerChannel = 16;
    doc.mode = "cmyk";
    doc.colorProfileName = "CMYK fixture";
    assert.deepEqual((await host.inspect()).format, { mode: "CMYK", depth: 16, profile: "CMYK fixture", ready: false, canConvert: true });
    await assert.rejects(host.read({ docId: doc.id }), /创建 8 位 sRGB 副本/);
    await assert.rejects(host.prepareCopy({ docId: 9 }), /已切换/);
    assert.equal(duplicateCount, 0);
    failConversion = true;
    await assert.rejects(host.prepareCopy({ docId: doc.id }), /conversion failure/);
    assert.equal(failedCopyClosed, true);
    failConversion = false;
    const copy = await host.prepareCopy({ docId: doc.id });
    assert.equal(copy.docId, 11);
    assert.equal(copy.format.ready, true);
    assert.equal(copy.hasSelection, true);
    assert.deepEqual(copy.masks, doc.layers.map(({ id, name }) => ({ id, name })));
    assert.deepEqual([doc.mode, doc.bitsPerChannel, doc.colorProfileName], ["cmyk", 16, "CMYK fixture"]);
    assert.equal((await host.read({ docId: copy.docId, layerId: target.id })).width, 8);
    for (let p = 0; p < 64; p++) rgba[p * 4 + 3] = 255;
    for (let y = 2; y < 6; y++) rgba.set([96, 96, 96, 255], (y * 8 + 3) * 4);
    const beauty = await host.read({ docId: copy.docId, layerId: target.id });
    await assert.rejects(host.apply({ id: beauty.id, fromPhotoshop: true, strength: 0 }), /美化强度/);
    await host.apply({ id: beauty.id, fromPhotoshop: true, strength: 100 });
    assert.equal(resultLayers.at(-1).name, "衣物美化 · 100%");
    assert.equal(resultLayers.at(-1).visible, true);
    assert.notDeepEqual(writePixels.imageData.data, rgba);
    const revised = await host.read({ docId: copy.docId, layerId: target.id });
    const beforeCount = resultLayers.length;
    const settings = { fine: 100, coarse: 80 };
    const detailed = host.getPreview({ id: revised.id, fromPhotoshop: true, settings });
    assert.equal(detailed.width, 8);
    assert.deepEqual(detailed.settings, { upper: 100, lower: 100, ...settings });
    assert.equal(resultLayers.length, beforeCount);
    await host.apply({ id: revised.id, fromPhotoshop: true, settings });
    assert.equal(resultLayers.at(-1).name, "衣物美化 · 细褶 100 粗褶 80");
    const separated = await host.read({ docId: copy.docId, layerId: target.id });
    const regions = Buffer.from(Uint8Array.from({ length: 64 }, (_, p) => p % 8 < 4 ? 1 : 2)).toString("base64");
    await host.apply({ id: separated.id, fromPhotoshop: true, regions, settings: { upper: 100, lower: 0, ...settings } });
    assert.equal(writeMask.imageData.data[3 * 8 + 3], 127);
    assert.equal(writeMask.imageData.data[3 * 8 + 4], 0);
    mock.app.activeDocument = doc;
    doc.mode = "rgb";
    doc.bitsPerChannel = 8;
    doc.colorProfileName = "None";
    assert.deepEqual((await host.inspect()).format, { mode: "RGB", depth: 8, profile: "无色彩配置", ready: false, canConvert: true });
    doc.bitsPerChannel = 32;
    assert.equal((await host.inspect()).format.canConvert, false);
    await assert.rejects(host.prepareCopy({ docId: doc.id }), /在 Photoshop 中/);
});

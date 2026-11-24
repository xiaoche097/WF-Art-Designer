const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");
const { composite, constrainMask } = require("../plugin/host/retouch/clothComposite");

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
            doc.layers.unshift(layer);
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
    mock.app.activeDocument = doc;
    doc.mode = "rgb";
    doc.bitsPerChannel = 8;
    doc.colorProfileName = "None";
    assert.deepEqual((await host.inspect()).format, { mode: "RGB", depth: 8, profile: "无色彩配置", ready: false, canConvert: true });
    doc.bitsPerChannel = 32;
    assert.equal((await host.inspect()).format.canConvert, false);
    await assert.rejects(host.prepareCopy({ docId: doc.id }), /在 Photoshop 中/);
});

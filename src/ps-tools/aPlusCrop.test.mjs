import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { A_PLUS, cropAPlusRegion, detectAPlusCrops } from "./aPlusCrop.js";

function image(width, height, boxes) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (const { x, y, width: w, height: h } of boxes) {
        for (let row = y; row < y + h; row++) {
            for (let column = x; column < x + w; column++) {
                data[(row * width + column) * 4] = (row + column) % 70;
                data[(row * width + column) * 4 + 1] = 80;
            }
        }
    }
    return { data, width, height };
}

test("continuous A+ designs split at full-size tile boundaries and retain @2x crop sizes", () => {
    const pc = [{ x: 0, y: 0, width: 1464, height: 600 }, { x: 0, y: 600, width: 1464, height: 600 }];
    assert.deepEqual(detectAPlusCrops(image(1464, 1200, pc), 1464, 1200), { pc, sj: [] });
    const halfSize = [{ x: 0, y: 0, width: 600, height: 450 }];
    assert.deepEqual(detectAPlusCrops(image(600, 450, halfSize), 1200, 900), {
        pc: [], sj: [{ x: 0, y: 0, width: 1200, height: 900 }],
    });
    assert.deepEqual(cropAPlusRegion({ x: 0, y: 0, width: 599, height: 450 }, A_PLUS.sj), []);
});

test("mixed A+ plans detect stacked and side-by-side PC and mobile panels", () => {
    const pc = [{ x: 0, y: 0, width: 1464, height: 600 }];
    for (const [width, height, x, y] of [[1464, 1200, 432, 660], [2124, 600, 1524, 0]]) {
        const sj = [{ x, y, width: 600, height: 450 }];
        assert.deepEqual(detectAPlusCrops(image(width, height, [...pc, ...sj]), width, height), { pc, sj });
    }
});

const jsx = readFileSync(new URL("../../plugin/ps-scripts/rename-from-list.jsx", import.meta.url), "utf8")
    .replace(/^\uFEFF?#target photoshop/m, "").replace(/batchRenameFromList\(\);\s*$/, "");

function selectedGroups({ ids, indices, background, docOnly = false }) {
    const layers = new Map(Array.from({ length: 10 }, (_, index) => [index + 1, {
        layerID: index + 1, itemIndex: 21 - index, layerSection: index === 9 ? "layerSectionContent" : "layerSectionStart",
    }]));
    const props = { targetLayersIDs: ids, targetLayers: indices };
    const context = {
        charIDToTypeID: key => key, stringIDToTypeID: key => key, typeIDToStringID: key => key,
        ActionReference: function () {
            this.putProperty = (_, key) => { this.property = key; };
            this.putEnumerated = type => { this.type = type; };
            this.putIdentifier = (_, id) => { this.id = id; };
            this.putIndex = (_, index) => { this.index = index; };
        },
        executeActionGet(ref) {
            if (ref.type === "Dcmn") {
                return {
                    hasKey: key => Boolean(props[key]) && (!docOnly || !ref.property),
                    getList: key => ({ count: props[key].length, getReference: index => ({
                        getIdentifier: () => props[key][index], getIndex: () => props[key][index],
                    }) }),
                };
            }
            const layer = ref.index != null ? [...layers.values()].find(entry => entry.itemIndex === ref.index) : layers.get(ref.id ?? 1);
            return { getInteger: key => layer[key], getEnumerationValue: key => layer[key] };
        },
        doc: { get backgroundLayer() { if (background) return {}; throw new Error("no background"); } },
    };
    return Array.from(runInNewContext(`${jsx}\ngetSelectedGroupsTopToBottom(doc);`, context), group => group.id);
}

test("rename counts all nine selected groups in stack order and ignores pixel layers", () => {
    assert.deepEqual(selectedGroups({ ids: [4, 9, 10, 2, 3, 7, 1, 6, 5, 8, 3] }), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("rename can read document-level selection or index lists with and without background", () => {
    assert.deepEqual(selectedGroups({ ids: [2, 1], docOnly: true }), [1, 2]);
    assert.deepEqual(selectedGroups({ ids: [1], indices: [19, 20] }), [1, 2]);
    assert.deepEqual(selectedGroups({ indices: [20, 21], background: true }), [1, 2]);
    assert.deepEqual(selectedGroups({}), [1]);
});

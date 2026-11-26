import test from "node:test";
import assert from "node:assert/strict";
import { initializeCanvas, writePsd } from "ag-psd";
import { analyzeStripes } from "./stripeAnalysis.js";
import { readStripeComposite, sampleStripeComposite } from "./stripePsd.js";
import { adjustStripeBands, stripePeriod, stripeInstruction } from "./stripeTexture.js";

const roi = { x: .04, y: .04, width: .92, height: .92 };
const colors = [[18, 35, 65], [210, 219, 220], [182, 80, 36]];
initializeCanvas(() => { throw new Error("This fixture uses raw pixels"); },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

test("reads merged PSD and PSB imagery and keeps original document dimensions", () => {
    const source = material(0, [12, 20]);
    for (const psb of [false, true]) {
        const bytes = writePsd({ width: 256, height: 256, imageData: source,
            children: [{ name: "Sample", top: 0, left: 0, imageData: source }] }, { psb });
        const decoded = readStripeComposite(bytes);
        assert.deepEqual([decoded.width, decoded.height], [256, 256]);
        const frame = sampleStripeComposite(decoded, 128);
        assert.deepEqual([frame.width, frame.height], [128, 128]);
        assert.deepEqual([...decoded.data.slice(0, 4)], [18, 35, 65, 255]);
        assert.deepEqual([...frame.data.slice(0, 4)], [114, 127, 142, 255]);
        const stripes = analyzeStripes(frame, roi, { sourceWidth: decoded.width, sourceHeight: decoded.height });
        assert.ok(Math.abs(stripes.period - 32) < 1);
    }
});

test("rejects malformed or oversized PSD headers before decoding", () => {
    const invalid = new ArrayBuffer(26);
    assert.throws(() => readStripeComposite(invalid), /有效的 PSD/);
    const header = new DataView(invalid);
    header.setUint32(0, 0x38425053);
    header.setUint16(4, 2);
    header.setUint32(14, 10000);
    header.setUint32(18, 10000);
    assert.throws(() => readStripeComposite(invalid), /2400 万像素/);
});

function material(angle, widths) {
    const width = 256, height = 256;
    const period = widths.reduce((total, value) => total + value, 0);
    const radians = angle * Math.PI / 180;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const distance = x * Math.sin(radians) - y * Math.cos(radians);
        let phase = (distance % period + period) % period;
        let color = 0;
        while (phase >= widths[color]) phase -= widths[color++];
        data.set([...colors[color], 255], (y * width + x) * 4);
    }
    return { data, width, height };
}

test("measures unequal widths in source pixels and computes local directions", () => {
    const found = analyzeStripes(material(0, [12, 20]), roi, { sourceWidth: 512, sourceHeight: 512 });
    assert.equal(found.reason, undefined);
    assert.equal(found.bands.length, 2);
    for (const [actual, expected] of found.bands.map(band => band.width).sort((a, b) => a - b).map((value, index) => [value, [24, 40][index]])) {
        assert.ok(Math.abs(actual - expected) < expected * .05, String(actual));
    }
    assert.equal(found.field.length, 9);
    assert.ok(found.field.every(patch => patch.coherence > .9));
});

test("separates a vertical three-color repeat and tilted two-color repeat", () => {
    const vertical = analyzeStripes(material(90, [8, 12, 16]), roi);
    assert.equal(new Set(vertical.bands.map(band => band.id)).size, 3);
    assert.ok(Math.abs(vertical.angle - 90) < 3);
    const tilted = analyzeStripes(material(35, [16, 16]), roi);
    assert.equal(new Set(tilted.bands.map(band => band.id)).size, 2);
    assert.ok(Math.abs(tilted.angle - 35) < 3);
    assert.ok(Math.abs(tilted.period - 32) < 1);
});

test("rejects uniform or transparent regions without manufacturing measurements", () => {
    const data = new Uint8Array(80 * 80 * 4).fill(255);
    assert.match(analyzeStripes({ data, width: 80, height: 80 }, roi).reason, /不明确/);
    const transparent = material(0, [10, 10]);
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0;
    assert.ok(analyzeStripes(transparent, roi).reason);
});

test("width controls respect their scope, restore 100%, and serialize the texture specification", () => {
    const bands = [{ id: 0, width: 16, color: "#112233" }, { id: 1, width: 16, color: "#ffffff" }];
    assert.deepEqual(adjustStripeBands(bands, 1, "all"), bands);
    const whole = adjustStripeBands(bands, .59, "all");
    assert.equal(stripePeriod(whole), 18.88);
    const selective = adjustStripeBands(bands, 5, 0, { 1: "#dddddd" });
    assert.deepEqual(selective.map(band => band.width), [32, 16]);
    assert.match(stripeInstruction("袖口", { angle: 70, period: 32 }, selective), /48.00 px[\s\S]*#dddddd/);
});

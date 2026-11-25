import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStoryboard, creativeSuites } from "./storyboard.js";
import { analyzeTileSeams } from "./tileSeams.js";

test("storyboard creates independent executable prompts from confirmed product details", () => {
    assert.deepEqual(buildStoryboard({ product: " " }), []);
    for (const suite of creativeSuites) {
        const shots = buildStoryboard({ suiteId: suite.id, product: " 米白 T 恤 ", facts: "实拍圆领",
            market: "日本站", language: "日语", artDirection: "柔光棚拍" });
        assert.equal(shots.length, 5);
        assert.deepEqual(shots.map(shot => shot.id), suite.shots);
        assert.equal(new Set(shots.map(shot => shot.prompt)).size, shots.length);
        for (const shot of shots) assert.match(shot.prompt, /米白 T 恤[\s\S]+实拍圆领[\s\S]+日本站[\s\S]+日语[\s\S]+柔光棚拍/);
    }
    assert.match(buildStoryboard({ suiteId: "apparel", product: "T 恤" }).find(shot => shot.id === "fit").prompt, /袖型/);
});

function pixels(pixel, width = 12, height = 12) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        data.set(pixel(x, y), (y * width + x) * 4);
    }
    return { data, width, height };
}

test("tile checks distinguish smooth seams, periodic stripes, and axis-specific discontinuity", () => {
    const periodic = pixels(x => x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    assert.equal(analyzeTileSeams(periodic).noticeable, false);
    const gradient = pixels(x => [x * 20, x * 20, x * 20, 255]);
    const report = analyzeTileSeams(gradient);
    assert.equal(report.leftRight.noticeable, true);
    assert.equal(report.topBottom.noticeable, false);
    const vertical = analyzeTileSeams(pixels((_, y) => [y * 20, y * 20, y * 20, 255]));
    assert.equal(vertical.leftRight.noticeable, false);
    assert.equal(vertical.topBottom.noticeable, true);
    const transparent = pixels(x => [x * 20, 200, 255, 0]);
    assert.equal(analyzeTileSeams(transparent).noticeable, false);
    assert.throws(() => analyzeTileSeams(pixels(() => [0, 0, 0, 255], 1)), /3 × 3/);
});
import { parseReverseSuite } from "./creativeWorkflows.js";
import { encodePNGFromRGBA, setPngDpi } from "../../plugin/host/wfArtAssistantPngCodec.js";
import { recolorPattern } from "./patternRecolor.js";
import { createCreativeZip, encodeCreativeZipText } from "../../plugin/host/creativeZip.js";

test("reverse suite validates shot count and produces a reusable storyboard", () => {
    const data = { name: "棚拍参考", style: "暖白棚拍", shots: [{ title: "主图", prompt: "白底正面视角" }] };
    const suite = parseReverseSuite(JSON.stringify(data), 1);
    const [shot] = buildStoryboard({ product: "棉质 T 恤" }, suite);
    assert.equal(shot.title, "主图");
    assert.match(shot.prompt, /暖白棚拍/);
    assert.match(shot.prompt, /白底正面视角/);
    assert.throws(() => parseReverseSuite(JSON.stringify(data), 2), /数量/);
    assert.throws(() => parseReverseSuite("not JSON", 1), /JSON/);
});

test("print PNG encodes 300 DPI as pHYs and preserves the original image chunks", () => {
    const original = encodePNGFromRGBA(1, 1, new Uint8Array([20, 60, 100, 255]));
    const marked = setPngDpi(original, 300);
    const twice = setPngDpi(marked, 300);
    const buffer = Buffer.from(marked);
    const type = buffer.indexOf("pHYs");
    assert.equal(buffer.readUInt32BE(type + 4), 11811);
    assert.equal(buffer.readUInt32BE(type + 8), 11811);
    assert.equal(buffer[type + 12], 1);
    assert.deepEqual(twice, marked);
    assert.deepEqual(buffer.subarray(buffer.indexOf("IDAT")), Buffer.from(original).subarray(Buffer.from(original).indexOf("IDAT")));
});

test("pattern recolor preserves alpha, unrelated colors and the original pixel buffer", () => {
    const frame = { width: 3, height: 1, data: new Uint8ClampedArray([20, 30, 40, 180, 200, 30, 40, 255, 20, 30, 40, 0]) };
    const result = recolorPattern(frame, [20, 30, 40], [40, 100, 160], 30);
    assert.deepEqual([...result.data], [40, 100, 160, 180, 200, 30, 40, 255, 20, 30, 40, 0]);
    assert.equal(frame.data[0], 20);
});

test("suite ZIP records UTF-8 names, CRC and local offsets", () => {
    const zip = Buffer.from(createCreativeZip([{ name: "套图.txt", bytes: encodeCreativeZipText("123456789") }]));
    const central = zip.readUInt32LE(zip.length - 6);
    assert.equal(zip.readUInt32LE(14), 0xcbf43926);
    assert.equal(zip.readUInt32LE(central), 0x02014b50);
    assert.equal(zip.readUInt32LE(central + 42), 0);
    assert.equal(zip.subarray(30, 30 + zip.readUInt16LE(26)).toString(), "套图.txt");
});

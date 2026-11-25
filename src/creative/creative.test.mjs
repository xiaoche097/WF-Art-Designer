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

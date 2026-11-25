// Work on straight RGBA. Keep alpha and every byte outside the authorized edit.
function composite(source, candidate, mask) {
    if (source.length !== candidate.length || source.length !== mask.length * 4) {
        throw new Error("衣物合成尺寸不匹配");
    }
    const output = new Uint8Array(source);
    for (let p = 0; p < mask.length; p++) {
        const i = p * 4;
        if (!mask[p] || !source[i + 3]) continue;
        const amount = mask[p] / 255;
        for (let c = 0; c < 3; c++) {
            output[i + c] = Math.round(source[i + c] + (candidate[i + c] - source[i + c]) * amount);
        }
    }
    return output;
}

function constrainMask(mask, rgba, constraints) {
    if (rgba.length !== mask.length * 4 || constraints.some(item => item.length !== mask.length)) {
        throw new Error("衣物蒙版尺寸不匹配");
    }
    const result = new Uint8Array(mask);
    for (let p = 0; p < result.length; p++) {
        if (!rgba[p * 4 + 3]) result[p] = 0;
        for (const constraint of constraints) result[p] = Math.min(result[p], constraint[p]);
    }
    return result;
}

function resizeMask(mask, width, height, targetWidth, targetHeight) {
    const result = new Uint8Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++) {
        const row = Math.floor((y + 0.5) * height / targetHeight) * width;
        for (let x = 0; x < targetWidth; x++) {
            result[y * targetWidth + x] = mask[row + Math.floor((x + 0.5) * width / targetWidth)];
        }
    }
    return result;
}

function interiorMask(mask, regions, width, height) {
    if (mask.length !== width * height || regions.length !== mask.length) throw Error("衣物识别范围尺寸不匹配");
    const result = new Uint8Array(mask.length);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1, p = y * width + 1; x < width - 1; x++, p++) {
            const label = regions[p];
            if (!label || !mask[p]) continue;
            const top = p - width, bottom = p + width;
            if (regions[top - 1] !== label || regions[top] !== label || regions[top + 1] !== label ||
                regions[p - 1] !== label || regions[p + 1] !== label ||
                regions[bottom - 1] !== label || regions[bottom] !== label || regions[bottom + 1] !== label) continue;
            result[p] = Math.min(mask[top - 1], mask[top], mask[top + 1], mask[p - 1], mask[p], mask[p + 1],
                mask[bottom - 1], mask[bottom], mask[bottom + 1]);
        }
    }
    return result;
}

function insideGarment(mask, regions, width, height, shoe = false) {
    const result = interiorMask(mask, regions, width, height);
    for (let p = 0; p < result.length; p++) {
        if (shoe ? regions[p] !== 4 : ![1, 2, 3, 5].includes(regions[p])) result[p] = 0;
    }
    return result;
}

// Leave a hard safety margin in the model grid, then feather only into reliable fabric.
function insetConfidenceMask(confidence, regions, width, height) {
    const hardMargin = interiorMask(interiorMask(confidence, regions, width, height), regions, width, height);
    const inner = interiorMask(hardMargin, regions, width, height);
    const core = interiorMask(inner, regions, width, height);
    return hardMargin.map((weight, p) => Math.round((weight + inner[p] + core[p]) / 3));
}

module.exports = { composite, constrainMask, resizeMask, insideGarment, insetConfidenceMask };

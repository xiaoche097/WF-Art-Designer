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

module.exports = { composite, constrainMask, resizeMask };

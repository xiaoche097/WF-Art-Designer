function boxBlur(input, width, height, radius) {
    const rows = new Float32Array(input.length);
    const result = new Float32Array(input.length);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let sum = 0;
        for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += input[row + x];
        for (let x = 0; x < width; x++) {
            rows[row + x] = sum / (Math.min(x + radius, width - 1) - Math.max(x - radius, 0) + 1);
            if (x >= radius) sum -= input[row + x - radius];
            if (x + radius + 1 < width) sum += input[row + x + radius + 1];
        }
    }
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += rows[y * width + x];
        for (let y = 0; y < height; y++) {
            result[y * width + x] = sum / (Math.min(y + radius, height - 1) - Math.max(y - radius, 0) + 1);
            if (y >= radius) sum -= rows[(y - radius) * width + x];
            if (y + radius + 1 < height) sum += rows[(y + radius + 1) * width + x];
        }
    }
    return result;
}

function buildToneField(rgba, mask, width, height) {
    const values = new Float32Array(mask.length);
    const weights = new Float32Array(mask.length);
    for (let p = 0; p < mask.length; p++) {
        if (rgba[p * 4 + 3] !== 255) continue;
        weights[p] = mask[p] / 255;
        values[p] = weights[p] * (rgba[p * 4] * .2126 + rgba[p * 4 + 1] * .7152 + rgba[p * 4 + 2] * .0722);
    }
    const narrow = Math.max(1, Math.round(Math.max(width, height) * .004));
    const wide = Math.max(narrow + 1, Math.round(Math.max(width, height) * .024));
    const fine = boxBlur(values, width, height, narrow);
    const fineWeight = boxBlur(weights, width, height, narrow);
    const broad = boxBlur(values, width, height, wide);
    const broadWeight = boxBlur(weights, width, height, wide);
    const result = new Float32Array(mask.length);
    for (let p = 0; p < result.length; p++) {
        if (!weights[p] || fineWeight[p] < .2 || broadWeight[p] < .2) continue;
        const difference = broad[p] / broadWeight[p] - fine[p] / fineWeight[p];
        // Attenuate mid-scale luminance, leaving fine texture in the original pixels.
        // Strong transitions (seams, prints and cast shadows) receive less correction.
        const edgeProtection = Math.max(0, 1 - Math.max(0, Math.abs(difference) - 16) / 32);
        result[p] = Math.max(-16, Math.min(16, difference * .78)) * edgeProtection;
    }
    return result;
}

function renderTone(rgba, width, height, field, fieldWidth, fieldHeight, mask, strength, blendMask = true) {
    const output = new Uint8Array(rgba);
    const matched = width === fieldWidth && height === fieldHeight;
    const scale = strength / 100;
    const xPositions = Float32Array.from({ length: width }, (_, x) =>
        Math.min(fieldWidth - 1, Math.max(0, (x + .5) * fieldWidth / width - .5)));
    for (let y = 0; y < height; y++) {
        const v = Math.min(fieldHeight - 1, Math.max(0, (y + .5) * fieldHeight / height - .5));
        const y0 = Math.floor(v);
        const row = y0 * fieldWidth;
        const lower = Math.min(y0 + 1, fieldHeight - 1) * fieldWidth;
        for (let x = 0, p = y * width; x < width; x++, p++) {
            const i = p * 4;
            if ((mask && !mask[p]) || rgba[i + 3] !== 255) continue;
            const u = xPositions[x], x0 = Math.floor(u), x1 = Math.min(x0 + 1, fieldWidth - 1);
            const top = field[row + x0] + (field[row + x1] - field[row + x0]) * (u - x0);
            const bottom = field[lower + x0] + (field[lower + x1] - field[lower + x0]) * (u - x0);
            const delta = (matched ? field[p] : top + (bottom - top) * (v - y0)) * scale * (blendMask ? mask[p] / 255 : 1);
            const bounded = Math.max(-Math.min(rgba[i], rgba[i + 1], rgba[i + 2]),
                Math.min(255 - Math.max(rgba[i], rgba[i + 1], rgba[i + 2]), Math.round(delta)));
            for (let channel = 0; channel < 3; channel++) output[i + channel] += bounded;
        }
    }
    return output;
}

module.exports = { buildToneField, renderTone };

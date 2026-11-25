// Relative seam analysis adapted from EcomGen's MIT-licensed tile-verify algorithm.
// Compare against the average along a whole interior join so a lone pixel cannot mask a seam.
const SEAM_TOLERANCE = 0.035;

function pixelDifference(data, a, b) {
    const alphaA = data[a + 3] / 255, alphaB = data[b + 3] / 255;
    return (Math.abs(data[a] * alphaA - data[b] * alphaB) +
        Math.abs(data[a + 1] * alphaA - data[b + 1] * alphaB) +
        Math.abs(data[a + 2] * alphaA - data[b + 2] * alphaB) +
        Math.abs(data[a + 3] - data[b + 3])) / 1020;
}

function seamAxis(data, count, lines, step, lineStep) {
    const joins = new Float64Array(count - 1);
    let edge = 0;
    for (let line = 0; line < lines; line++) {
        const start = line * lineStep;
        edge += pixelDifference(data, start, start + (count - 1) * step);
        for (let p = 0; p < joins.length; p++) {
            const i = start + p * step;
            joins[p] += pixelDifference(data, i, i + step);
        }
    }
    const excess = Math.max(0, (edge - Math.max(...joins)) / lines);
    return { noticeable: excess > SEAM_TOLERANCE, excess };
}

export function analyzeTileSeams({ data, width, height }) {
    if (width < 3 || height < 3 || data.length !== width * height * 4) {
        throw Error("花型至少需要 3 × 3 像素。");
    }
    const leftRight = seamAxis(data, width, height, 4, width * 4);
    const topBottom = seamAxis(data, height, width, width * 4, 4);
    return { leftRight, topBottom, noticeable: leftRight.noticeable || topBottom.noticeable };
}

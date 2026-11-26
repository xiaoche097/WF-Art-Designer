import { measureStripePeriod } from "./stripeSignal.js";
import { measureStripeBands } from "./stripeColor.js";

function tensor(frame, left, top, right, bottom) {
    const { width, data } = frame;
    let xx = 0, xy = 0, yy = 0;
    for (let y = top + 1; y < bottom - 1; y += 2) {
        for (let x = left + 1; x < right - 1; x += 2) {
            const p = (y * width + x) * 4;
            const vertical = width * 4;
            if (Math.min(data[p + 7], data[p - 1], data[p + vertical + 3], data[p - vertical + 3]) < 240) continue;
            for (let c = 0; c < 3; c++) {
                const dx = data[p + 4 + c] - data[p - 4 + c];
                const dy = data[p + vertical + c] - data[p - vertical + c];
                xx += dx * dx; yy += dy * dy; xy += dx * dy;
            }
        }
    }
    return { angle: .5 * Math.atan2(2 * xy, xx - yy), coherence: Math.hypot(xx - yy, 2 * xy) / (xx + yy || 1) };
}

function project(frame, box, normal) {
    const { width, data } = frame;
    const cx = Math.floor((box.left + box.right - 1) / 2), cy = Math.floor((box.top + box.bottom - 1) / 2);
    const nx = Math.cos(normal), ny = Math.sin(normal);
    const reach = Math.floor(Math.min((box.right - box.left) / (Math.abs(nx) + 1e-6),
        (box.bottom - box.top) / (Math.abs(ny) + 1e-6)) * .48);
    const band = Math.min(box.right - box.left, box.bottom - box.top) * .27;
    const size = 2 * reach + 1;
    const counts = new Uint32Array(size), rows = Array.from({ length: 3 }, () => new Float64Array(size));
    for (let y = box.top; y < box.bottom; y++) {
        for (let x = box.left; x < box.right; x++) {
            const dx = x - cx, dy = y - cy;
            if (Math.abs(-dx * ny + dy * nx) > band) continue;
            const i = Math.round(dx * nx + dy * ny) + reach;
            const p = (y * width + x) * 4;
            if (i < 0 || i >= size || data[p + 3] < 240) continue;
            counts[i]++;
            for (let c = 0; c < 3; c++) rows[c][i] += data[p + c];
        }
    }
    const threshold = Math.max(3, band * .65);
    let first = reach, last = reach;
    while (first > 0 && counts[first - 1] >= threshold) first--;
    while (last < size - 1 && counts[last + 1] >= threshold) last++;
    if (last - first < 15 || counts[reach] < threshold) return null;
    return rows.map(channel => channel.slice(first, last + 1).map((value, index) => value / counts[first + index]));
}

function direction(angle) {
    const degrees = ((angle * 180 / Math.PI + 90) % 180 + 180) % 180;
    return degrees > 90 ? degrees - 180 : degrees;
}

export function analyzeStripes(frame, roi, { angle, colors, sourceWidth = frame.width, sourceHeight = frame.height } = {}) {
    const { width, height } = frame;
    const box = {
        left: Math.floor(roi.x * width), top: Math.floor(roi.y * height),
        right: Math.min(width, Math.ceil((roi.x + roi.width) * width)),
        bottom: Math.min(height, Math.ceil((roi.y + roi.height) * height)),
    };
    if (box.right - box.left < 20 || box.bottom - box.top < 20) return { reason: "选区太小，请框入至少两组完整条纹。" };
    const principal = tensor(frame, box.left, box.top, box.right, box.bottom);
    const manual = Number.isFinite(angle);
    if (!manual && principal.coherence < .38) return { reason: "主方向不明确。请缩小到单块平整面料，或手动填写条纹方向。" };
    const measure = normal => {
        const profile = project(frame, box, normal);
        const measurement = profile && measureStripePeriod(profile);
        return measurement && measurement.gabor >= .21
            ? { normal, profile, measurement, score: measurement.contrast * measurement.correlation ** 2 } : null;
    };
    let result;
    if (manual) result = measure((angle - 90) * Math.PI / 180);
    else {
        const step = Math.PI / 180;
        for (const shift of [0, -4, 4, -8, 8]) {
            const attempt = measure(principal.angle + shift * step);
            if (attempt && (!result || attempt.score > result.score)) result = attempt;
        }
        if (result) {
            const best = result.normal;
            for (const shift of [-2, 2, -1, 1]) {
                const attempt = measure(best + shift * step);
                if (attempt && attempt.score > result.score) result = attempt;
            }
        }
    }
    if (!result) return { reason: "周期不稳定。请选择包含至少两组完整条纹的平整区域。" };
    const { normal, profile, measurement } = result;
    const bands = measureStripeBands(profile, measurement.period, colors);
    if (!bands.length) return { reason: "颜色边界无法可靠分离。请避开阴影、褶皱和接缝，或调整颜色数。" };
    const scale = 1 / Math.hypot(Math.cos(normal) * width / sourceWidth, Math.sin(normal) * height / sourceHeight);
    const field = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        const dx = (box.right - box.left) / 3, dy = (box.bottom - box.top) / 3;
        const patch = tensor(frame, box.left + Math.floor(dx * col), box.top + Math.floor(dy * row),
            box.left + Math.floor(dx * (col + 1)), box.top + Math.floor(dy * (row + 1)));
        field.push({ angle: direction(patch.angle), coherence: patch.coherence });
    }
    return { bands: bands.map(band => ({ ...band, width: band.width * scale })), period: measurement.period * scale,
        angle: direction(normal), correlation: measurement.correlation, field, sampledScale: scale };
}

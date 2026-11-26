const linear = Array.from({ length: 256 }, (_, value) => {
    const c = value / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
});

function lab([r, g, b]) {
    const [a, c, d] = [r, g, b].map(value => linear[Math.round(value)]);
    const t = x => x > .00885645 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
    const x = t((.4124564 * a + .3575761 * c + .1804375 * d) / .95047);
    const y = t(.2126729 * a + .7151522 * c + .072175 * d);
    const z = t((.0193339 * a + .119192 * c + .9503041 * d) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const squaredDistance = (left, right) => left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
const hex = rgb => "#" + rgb.map(value => Math.round(value).toString(16).padStart(2, "0")).join("");

function fitColors(points, initial) {
    let centers = initial;
    let labels = [];
    for (let pass = 0; pass < 12; pass++) {
        labels = points.map(point => centers.reduce((best, center, i) =>
            squaredDistance(point, center) < squaredDistance(point, centers[best]) ? i : best, 0));
        const sums = centers.map(() => [0, 0, 0, 0]);
        labels.forEach((id, i) => {
            sums[id][3]++;
            for (let c = 0; c < 3; c++) sums[id][c] += points[i][c];
        });
        const next = sums.map(([a, b, c, n], id) => n ? [a / n, b / n, c / n] : centers[id]);
        if (next.every((value, id) => squaredDistance(value, centers[id]) < .001)) break;
        centers = next;
    }
    return { centers, labels, error: points.reduce((sum, point, i) => sum + squaredDistance(point, centers[labels[i]]), 0) };
}

function colorRuns(labels) {
    const length = labels.length;
    const start = labels.findIndex((label, index) => label !== labels[(index + length - 1) % length]);
    if (start < 0) return [];
    const runs = [];
    for (let i = 0; i < length; i++) {
        const index = (start + i) % length;
        const id = labels[index];
        if (runs.at(-1)?.id !== id) runs.push({ id, indexes: [] });
        runs.at(-1).indexes.push(index);
    }
    return runs;
}

export function measureStripeBands(profile, period, requestedColors) {
    const bins = Math.min(512, Math.max(48, Math.round(period * 6)));
    const cycles = Math.floor((profile[0].length - 1) / period);
    if (cycles < 2) return [];
    const first = (profile[0].length - 1 - cycles * period) / 2;
    const colors = Array.from({ length: bins }, (_, phase) => profile.map(channel => {
        const samples = [];
        for (let c = 0; c < cycles; c++) {
            const at = first + (c + phase / bins) * period;
            const i = Math.floor(at);
            samples.push(channel[i] + (channel[i + 1] - channel[i]) * (at - i));
        }
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
    }));
    const points = colors.map(lab);
    let fitted = fitColors(points, [points[0]]);
    const minRun = Math.max(Math.ceil(bins * .035), Math.ceil(bins / period * .9));
    for (let k = 2; k <= (requestedColors || 6); k++) {
        let farthest = 0, distance = 0;
        points.forEach((point, index) => {
            const current = squaredDistance(point, fitted.centers[fitted.labels[index]]);
            if (current > distance) { distance = current; farthest = index; }
        });
        if (distance < 24) break;
        const next = fitColors(points, [...fitted.centers, points[farthest]]);
        if (!requestedColors && k > 2 && next.error > fitted.error * .64) break;
        if (!requestedColors && colorRuns(next.labels).filter(run => run.id === k - 1).every(run => run.indexes.length < minRun * 2)) break;
        fitted = next;
    }
    for (const run of colorRuns(fitted.labels)) {
        if (run.indexes.length >= minRun) continue;
        const start = run.indexes[0], end = run.indexes.at(-1);
        const previous = fitted.labels[(start + bins - 1) % bins], following = fitted.labels[(end + 1) % bins];
        const split = Math.round(run.indexes.length / 2);
        run.indexes.forEach((index, ordinal) => { fitted.labels[index] = ordinal < split ? previous : following; });
    }
    const runs = colorRuns(fitted.labels);
    const ids = [...new Set(runs.map(run => run.id))].sort((a, b) => fitted.centers[a][0] - fitted.centers[b][0]);
    if (ids.length < 2 || requestedColors && requestedColors !== ids.length) return [];
    const palette = ids.map(id => {
        const interiors = runs.filter(run => run.id === id).flatMap(run => {
            const trim = Math.floor(run.indexes.length * .24);
            return run.indexes.slice(trim, run.indexes.length - trim);
        });
        return hex([0, 1, 2].map(channel => interiors.reduce((sum, index) => sum + colors[index][channel], 0) / interiors.length));
    });
    return runs.map(run => ({
        id: ids.indexOf(run.id),
        color: palette[ids.indexOf(run.id)],
        width: period * run.indexes.length / bins,
    }));
}

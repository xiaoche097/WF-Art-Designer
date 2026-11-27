export const A_PLUS = Object.freeze({
    pc: { title: "A+裁图-PC", width: 1464, height: 600, suffix: "PC" },
    sj: { title: "A+裁图-SJ", width: 600, height: 450, suffix: "MOBILE" },
});

function runs(flags, wanted) {
    const result = [];
    let start = -1;
    for (let i = 0; i <= flags.length; i++) {
        if (i < flags.length && flags[i] === wanted) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            result.push([start, i]);
            start = -1;
        }
    }
    return result;
}

function readPixel(frame, x, y) {
    const offset = (y * frame.width + x) * 4;
    const alpha = frame.data[offset + 3] / 255;
    return [0, 1, 2].map(channel => Math.round(frame.data[offset + channel] * alpha + 255 * (1 - alpha)));
}

function isBackground(frame, x, y, color) {
    const offset = (y * frame.width + x) * 4;
    const alpha = frame.data[offset + 3] / 255;
    for (let c = 0; c < 3; c++) {
        if (Math.abs(frame.data[offset + c] * alpha + 255 * (1 - alpha) - color[c]) > 16) return false;
    }
    return true;
}

export function cropAPlusRegion(box, target, anchor = "center") {
    const ratio = Math.round(box.width / target.width);
    const scale = ratio >= 2 && ratio <= 4 && Math.abs(box.width - target.width * ratio) <= 4 &&
        box.width >= target.width * ratio && box.height >= target.height * ratio ? ratio : 1;
    const width = target.width * scale, height = target.height * scale;
    if (box.width < width || box.height < height) return [];
    const tiles = Math.floor(box.height / height);
    const leftover = box.height - tiles * height;
    const start = anchor === "top" ? 0 : anchor === "bottom" ? leftover : Math.floor(leftover / 2);
    return Array.from({ length: tiles }, (_, index) => ({
        x: box.x + Math.floor((box.width - width) / 2),
        y: box.y + start + index * height,
        width, height,
    }));
}

function classifyBox(box) {
    const candidates = Object.entries(A_PLUS).flatMap(([mode, target]) => {
        const crops = cropAPlusRegion(box, target);
        if (!crops.length) return [];
        const coverage = crops.length * crops[0].width * crops[0].height / (box.width * box.height);
        return [{ mode, score: coverage, crops }];
    });
    return candidates.sort((a, b) => b.score - a.score)[0];
}

export function detectAPlusCrops(frame, width, height) {
    const sw = width / frame.width, sh = height / frame.height;
    const candidates = new Map();
    function add(color, priority) {
        const key = color.map(value => Math.round(value / 12)).join(",");
        const prior = candidates.get(key);
        candidates.set(key, { color: prior?.color || color, weight: (prior?.weight || 0) + priority });
    }
    for (const [x, y] of [[0, 0], [frame.width - 1, 0], [0, frame.height - 1], [frame.width - 1, frame.height - 1]]) add(readPixel(frame, x, y), 6);
    for (let y = 0; y < frame.height; y++) {
        const color = readPixel(frame, 0, y);
        let uniform = true;
        for (let x = 1; x < frame.width; x += 4) {
            if (!isBackground(frame, x, y, color)) { uniform = false; break; }
        }
        if (uniform) add(color, 1);
    }
    const backgrounds = [...candidates.values()].sort((a, b) => b.weight - a.weight).slice(0, 5);
    const full = { x: 0, y: 0, width, height };
    const initial = classifyBox(full);
    let best = initial?.score >= .95 ? [initial] : [];
    let bestScore = best.length ? initial.score : 0;
    let bestMixed = false;
    for (const { color } of backgrounds) {
        const blanks = Array.from({ length: frame.height }, (_, y) => {
            for (let x = 0; x < frame.width; x++) if (!isBackground(frame, x, y, color)) return false;
            return true;
        });
        for (const [start, end] of runs(blanks, true)) {
            if ((end - start) * sh < 3) blanks.fill(false, start, end);
        }
        const plan = [];
        for (const [top, bottom] of runs(blanks, false)) {
            if ((bottom - top) * sh < 440) continue;
            const columns = Array.from({ length: frame.width }, (_, x) => {
                for (let y = top; y < bottom; y++) if (!isBackground(frame, x, y, color)) return true;
                return false;
            });
            for (const [start, end] of runs(columns, false)) {
                if ((end - start) * sw < 8) columns.fill(true, start, end);
            }
            for (const [left, right] of runs(columns, true)) {
                function emptyRow(row) {
                    for (let x = left; x < right; x++) if (!isBackground(frame, x, row, color)) return false;
                    return true;
                }
                let start = top, end = bottom;
                while (start < end && emptyRow(start)) start++;
                while (end > start && emptyRow(end - 1)) end--;
                const x = Math.floor(left * sw), y = Math.floor(start * sh);
                const box = { x, y, width: Math.min(width, Math.ceil(right * sw)) - x,
                    height: Math.min(height, Math.ceil(end * sh)) - y };
                const panel = classifyBox(box);
                if (panel?.score >= .70) plan.push(panel);
            }
        }
        const score = plan.reduce((sum, panel) =>
            sum + panel.score * panel.crops.reduce((area, crop) => area + crop.width * crop.height, 0), 0) / (width * height);
        const mixed = new Set(plan.filter(panel => panel.score >= .92).map(panel => panel.mode)).size > 1;
        if ((mixed && !bestMixed) || (mixed === bestMixed && score > bestScore)) {
            best = plan;
            bestScore = score;
            bestMixed = mixed;
        }
    }
    if (!best.length && initial) best = [initial];
    return Object.fromEntries(Object.keys(A_PLUS).map(mode => [mode,
        best.filter(panel => panel.mode === mode).flatMap(panel => panel.crops).sort((a, b) => a.y - b.y || a.x - b.x)]));
}

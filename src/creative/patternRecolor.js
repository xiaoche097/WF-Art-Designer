export function recolorPattern(frame, source, target, tolerance) {
    const pixels = new Uint8ClampedArray(frame.data);
    const limit = Math.max(1, tolerance);
    const squaredLimit = limit * limit;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        if (!pixels[offset + 3]) continue;
        const r = pixels[offset] - source[0];
        const g = pixels[offset + 1] - source[1];
        const b = pixels[offset + 2] - source[2];
        const distance = r * r + g * g + b * b;
        if (distance >= squaredLimit) continue;
        const weight = Math.min(1, (limit - Math.sqrt(distance)) / (limit * .45));
        pixels[offset] += (target[0] - source[0]) * weight;
        pixels[offset + 1] += (target[1] - source[1]) * weight;
        pixels[offset + 2] += (target[2] - source[2]) * weight;
    }
    return { data: pixels, width: frame.width, height: frame.height };
}

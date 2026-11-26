export const stripePixels = value => Number(value).toFixed(2);

export function adjustStripeBands(bands, scale, colorId, replacements = {}) {
    const factor = Math.max(.25, Math.min(2, scale));
    return bands.map(band => ({
        ...band, width: band.width * (colorId === "all" || band.id === colorId ? factor : 1),
        color: replacements[band.id] || band.color,
    }));
}

export function stripePeriod(bands) {
    return bands.reduce((sum, band) => sum + band.width, 0);
}

export function stripeTexturePng(bands) {
    const period = stripePeriod(bands);
    const canvas = document.createElement("canvas");
    // Rasterize exactly one repeat at an oversampled resolution. Its first
    // pixel follows the last pixel of the preceding tile.
    canvas.width = 128;
    canvas.height = Math.min(4096, Math.max(8, Math.round(period * 4)));
    const ctx = canvas.getContext("2d");
    let position = 0, edge = 0;
    for (const band of bands) {
        position += band.width;
        const end = Math.round(position / period * canvas.height);
        ctx.fillStyle = band.color;
        ctx.fillRect(0, edge, canvas.width, end - edge);
        edge = end;
    }
    return canvas;
}

export function stripeInstruction(name, analysis, target) {
    const bands = target.map(band => `${band.color} / ${stripePixels(band.width)} px`).join(" → ");
    return [
        `编辑区域：${name}。以所附原图和标准纹理 PNG 为参考。只处理该衣片内原本存在的条纹。`,
        `取样方向（图像水平为 0°）：${stripePixels(analysis.angle)}°；原周期 ${stripePixels(analysis.period)} px。`,
        `平整参考面的目标周期 ${stripePixels(stripePeriod(target))} px。一个周期的颜色和宽度顺序：${bands}。`,
        "标准纹理参考按垂直于条纹的方向读取。服装内沿该衣片原有的方向、弯曲和褶皱映射纹理，保持车缝、翻折和遮挡关系。各衣片独立，缝线上不强行对齐。",
        "保留原图尺寸、版型、光影、面料质感和印花以外细节。不要拉伸原图、模糊边缘、重画皮肤或背景。编辑区域以外保持原样。",
    ].join("\n");
}

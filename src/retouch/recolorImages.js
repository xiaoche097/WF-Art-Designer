const MAX_EDGE = 640;

function bytesFromBase64(encoded) {
    return Uint8ClampedArray.from(atob(encoded), char => char.charCodeAt(0));
}

export function readRecolorSample(sample) {
    const { width, height, selection, bounds, maskWidth, maskHeight } = sample;
    const data = bytesFromBase64(sample.rgbaB64);
    const mask = bytesFromBase64(sample.weightB64);
    if (!width || !height || data.length !== width * height * 4 || !bounds.width || !bounds.height ||
        !maskWidth || !maskHeight || mask.length !== maskWidth * maskHeight) {
        throw new Error("Photoshop 返回的图像或蒙版数据不完整");
    }
    const weight = new Float32Array(width * height);
    const scaleX = (selection.right - selection.left) / width;
    const scaleY = (selection.bottom - selection.top) / height;
    for (let y = 0; y < height; y++) {
        const my = Math.floor((selection.top + (y + 0.5) * scaleY - bounds.y) * maskHeight / bounds.height);
        if (my < 0 || my >= maskHeight) continue;
        for (let x = 0; x < width; x++) {
            const mx = Math.floor((selection.left + (x + 0.5) * scaleX - bounds.x) * maskWidth / bounds.width);
            if (mx >= 0 && mx < maskWidth) weight[y * width + x] = mask[my * maskWidth + mx] / 255;
        }
    }
    if (!weight.some(Boolean)) throw new Error("目标蒙版与可见图像没有交集");
    return { image: { data, width, height }, weight };
}

export function referenceFromFile(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error("图片超过 20 MB");
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            try {
                const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const ctx = canvas.getContext("2d");
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                if (canvas.width < 3 || canvas.height < 3) throw new Error("图片太小");
                resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("无法读取图片，请使用 PNG、JPG 或 WebP"));
        };
        image.src = url;
    });
}

export function overlayPreview(original, painted) {
    const data = new Uint8ClampedArray(original.data);
    for (let i = 0; i < data.length; i += 4) {
        const mask = original.data[i + 3] ? painted.data[i + 3] / original.data[i + 3] : 0;
        for (let c = 0; c < 3; c++) data[i + c] += (painted.data[i + c] - data[i + c]) * mask;
    }
    return { width: original.width, height: original.height, data };
}

import { readPsd } from "ag-psd";

export const photoshopFileLimit = 128 * 1024 * 1024;
const maxDocumentPixels = 24000000;

export function readStripeComposite(buffer) {
    const header = new DataView(buffer);
    if (header.byteLength < 26 || header.getUint32(0) !== 0x38425053 || ![1, 2].includes(header.getUint16(4))) {
        throw new Error("文件不是有效的 PSD 或 PSB");
    }
    const height = header.getUint32(14), width = header.getUint32(18);
    if (!width || !height || width * height > maxDocumentPixels) {
        throw new Error("文件的画布超过 2400 万像素，请在 Photoshop 打开后读取图层或选区");
    }
    if (![1, 3].includes(header.getUint16(24))) {
        throw new Error("文件取样支持 RGB 和灰度文档。其他色彩模式请在 Photoshop 中打开后取样");
    }
    const channels = header.getUint16(12), depth = header.getUint16(22);
    if (![8, 16, 32].includes(depth) || channels < 1 || channels > 56 || width * height * channels * depth / 8 > 192 * 1024 * 1024) {
        throw new Error("该文件的色深或通道数据超出直接取样范围，请在 Photoshop 中打开后取样");
    }
    let merged;
    try {
        merged = readPsd(buffer, {
            useImageData: true,
            skipLayerImageData: true,
            skipThumbnail: true,
            skipLinkedFilesData: true,
            totalMemoryLimit: 192 * 1024 * 1024,
        }).imageData;
    } catch (_) {
        throw new Error("无法读取文件的合成图。请用 Photoshop 打开后取样，或启用「最大兼容性」后另存");
    }
    if (!merged || merged.width !== width || merged.height !== height || merged.data.length !== width * height * 4) {
        throw new Error("文件未保存完整的合成图，请在 Photoshop 打开后取样");
    }
    return merged;
}

export function sampleStripeComposite({ width, height, data }, maxEdge = 1024) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const output = new Uint8ClampedArray(outWidth * outHeight * 4);
    const alphaMax = data instanceof Float32Array ? 1 : data instanceof Uint16Array ? 65535 : 255;
    const isLinear = data instanceof Float32Array;
    const toByte = value => {
        const unit = value / alphaMax;
        if (!isLinear) return unit * 255;
        return 255 * (unit <= .0031308 ? unit * 12.92 : 1.055 * unit ** (1 / 2.4) - .055);
    };
    for (let y = 0; y < outHeight; y++) {
        const top = Math.floor(y * height / outHeight), bottom = Math.floor((y + 1) * height / outHeight);
        for (let x = 0; x < outWidth; x++) {
            const left = Math.floor(x * width / outWidth), right = Math.floor((x + 1) * width / outWidth);
            let r = 0, g = 0, b = 0, alpha = 0;
            for (let row = top; row < bottom; row++) {
                for (let col = left; col < right; col++) {
                    const offset = (row * width + col) * 4;
                    const a = data[offset + 3];
                    r += data[offset] * a;
                    g += data[offset + 1] * a;
                    b += data[offset + 2] * a;
                    alpha += a;
                }
            }
            const index = (y * outWidth + x) * 4;
            if (!alpha) continue;
            output[index] = toByte(r / alpha);
            output[index + 1] = toByte(g / alpha);
            output[index + 2] = toByte(b / alpha);
            output[index + 3] = 255 * alpha / (alphaMax * (bottom - top) * (right - left));
        }
    }
    return { width: outWidth, height: outHeight, data: output };
}

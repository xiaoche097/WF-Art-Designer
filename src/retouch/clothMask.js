import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";

const INPUT_EDGE = 512;
const MODEL = "schp-atr-18-int8-static.onnx";
const WASM = "ort-wasm-simd-threaded";
let sessionPromise;

function loadPackagedBytes(file) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const cleanup = () => {
            clearTimeout(timeout);
            script.remove();
        };
        const fail = () => {
            cleanup();
            reject(Error("安装包中的衣物识别资源读取失败"));
        };
        const timeout = setTimeout(fail, 20000);
        script.src = "./cloth-model/" + file + ".packed.js";
        script.onerror = fail;
        script.onload = () => {
            cleanup();
            const encoded = window.__wfClothResource;
            delete window.__wfClothResource;
            try {
                if (Uint8Array.fromBase64) resolve(Uint8Array.fromBase64(encoded));
                else {
                    const data = atob(encoded);
                    const bytes = new Uint8Array(data.length);
                    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
                    resolve(bytes);
                }
            } catch (error) { reject(error); }
        };
        document.head.appendChild(script);
    });
}

async function loadSession() {
    const wasm = await loadPackagedBytes(WASM + ".wasm");
    const loader = await loadPackagedBytes(WASM + ".mjs");
    const model = await loadPackagedBytes(MODEL);
    const mjs = URL.createObjectURL(new Blob([loader], { type: "text/javascript" }));
    const binary = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    env.wasm.numThreads = 1;
    env.wasm.wasmPaths = { mjs, wasm: binary };
    try {
        return await InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    } finally {
        URL.revokeObjectURL(mjs);
        URL.revokeObjectURL(binary);
    }
}

function tensorFromImage({ width, height, pixels }) {
    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const context = source.getContext("2d");
    context.putImageData(new ImageData(pixels, width, height), 0, 0);

    const input = document.createElement("canvas");
    input.width = input.height = INPUT_EDGE;
    const target = input.getContext("2d");
    target.fillStyle = "white";
    target.fillRect(0, 0, INPUT_EDGE, INPUT_EDGE);
    target.drawImage(source, 0, 0, INPUT_EDGE, INPUT_EDGE);
    const rgba = target.getImageData(0, 0, INPUT_EDGE, INPUT_EDGE).data;
    const plane = INPUT_EDGE * INPUT_EDGE;
    const data = new Float32Array(plane * 3);
    const mean = [.406, .456, .485];
    const deviation = [.225, .224, .229];
    for (let channel = 0; channel < 3; channel++) {
        for (let p = 0; p < plane; p++) data[channel * plane + p] = (rgba[p * 4 + channel] / 255 - mean[channel]) / deviation[channel];
    }
    return new Tensor("float32", data, [1, 3, INPUT_EDGE, INPUT_EDGE]);
}

function clothingPixels(logits, frame, limit) {
    const { width, height, pixels } = frame;
    const [, classes, rows, cols] = logits.dims;
    if (classes !== 18) throw Error("衣物模型输出类别不符合预期");
    const plane = rows * cols;
    const scores = logits.data;
    const classRegion = { 4: 1, 5: 5, 6: 2, 7: 3, 9: 4, 10: 4 };
    const type = new Uint8Array(plane);
    const opacity = new Uint8Array(plane);
    for (let p = 0; p < plane; p++) {
        let best = -Infinity, runnerUp = -Infinity, label = 0;
        for (let c = 0; c < classes; c++) {
            const score = scores[c * plane + p];
            if (score > best) {
                runnerUp = best;
                best = score;
                label = c;
            } else if (score > runnerUp) runnerUp = score;
        }
        const region = classRegion[label];
        if (!region || best - runnerUp < .8) continue;
        type[p] = region;
        opacity[p] = Math.round(Math.min(1, (best - runnerUp - .8) / 1.4) * 255);
    }
    const mask = new Uint8ClampedArray(width * height);
    const regions = new Uint8Array(width * height);
    for (let y = 0, p = 0; y < height; y++) {
        const row = Math.floor((y + .5) * rows / height) * cols;
        for (let x = 0; x < width; x++, p++) {
            if (!limit[p] || pixels[p * 4 + 3] !== 255) continue;
            const t = row + Math.floor((x + .5) * cols / width);
            mask[p] = Math.min(limit[p], opacity[t]);
            if (mask[p]) regions[p] = type[t];
        }
    }
    return mask.some(Boolean) ? { mask, regions } : null;
}

export async function findClothes(frame, limit) {
    sessionPromise ??= loadSession().catch(error => {
        sessionPromise = null;
        throw error;
    });
    const session = await sessionPromise;
    const tensor = tensorFromImage(frame);
    const { logits } = await session.run({ pixel_values: tensor }, ["logits"]);
    return clothingPixels(logits, frame, limit);
}

import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

let segmenterPromise;

function loadPackagedBytes(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url + ".packed.js";
        script.onload = () => {
            script.remove();
            const encoded = window.__wfClothResource;
            delete window.__wfClothResource;
            try {
                const data = atob(encoded);
                const bytes = new Uint8Array(data.length);
                for (let index = 0; index < data.length; index++) bytes[index] = data.charCodeAt(index);
                resolve(bytes);
            } catch (error) {
                reject(error);
            }
        };
        script.onerror = () => {
            script.remove();
            reject(Error("安装包中的衣物识别资源读取失败"));
        };
        document.head.appendChild(script);
    });
}

async function createSegmenter() {
    const base = new URL("./cloth-model/", document.baseURI).href;
    const files = await FilesetResolver.forVisionTasks(base.slice(0, -1));
    const wasm = await loadPackagedBytes(files.wasmBinaryPath);
    const loader = await loadPackagedBytes(files.wasmLoaderPath);
    const model = await loadPackagedBytes(base + "selfie_multiclass_256x256.tflite");
    const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    const loaderUrl = URL.createObjectURL(new Blob([loader], { type: "text/javascript" }));
    try {
        return await ImageSegmenter.createFromOptions({ ...files, wasmBinaryPath: wasmUrl, wasmLoaderPath: loaderUrl }, {
            baseOptions: { modelAssetBuffer: model, delegate: "CPU" },
            runningMode: "IMAGE", outputCategoryMask: false, outputConfidenceMasks: true,
        });
    } finally {
        URL.revokeObjectURL(wasmUrl);
        URL.revokeObjectURL(loaderUrl);
    }
}

function loadSegmenter() {
    if (!segmenterPromise) {
        segmenterPromise = createSegmenter().catch(error => {
            segmenterPromise = null;
            throw error;
        });
    }
    return segmenterPromise;
}

export async function findClothes({ width, height, pixels }, limit) {
    const segmenter = await loadSegmenter();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    const clothesIndex = segmenter.getLabels().indexOf("clothes");
    if (clothesIndex < 0) throw Error("衣物识别模型缺少衣物类别");
    const output = new Uint8ClampedArray(width * height);
    segmenter.segment(canvas, ({ confidenceMasks }) => {
        const { width: mw, height: mh } = confidenceMasks[clothesIndex];
        const probabilities = confidenceMasks.map(mask => mask.getAsFloat32Array());
        for (let y = 0, p = 0; y < height; y++) {
            const row = Math.floor((y + .5) * mh / height) * mw;
            for (let x = 0; x < width; x++, p++) {
                if (!limit[p] || pixels[p * 4 + 3] !== 255) continue;
                const index = row + Math.floor((x + .5) * mw / width);
                const confidence = probabilities[clothesIndex][index];
                let competitor = 0;
                for (let c = 0; c < probabilities.length; c++) {
                    if (c !== clothesIndex) competitor = Math.max(competitor, probabilities[c][index]);
                }
                if (confidence < .58 || confidence - competitor < .18) continue;
                output[p] = Math.min(limit[p], 255 * Math.min(1, (confidence - .58) / .24));
            }
        }
    });
    return output.some(Boolean) ? output : null;
}

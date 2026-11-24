const fs = require("node:fs/promises");
const { createHash, randomUUID } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const model = "selfie_multiclass_256x256.tflite";
const expected = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0";
const modelUrl = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/" + model;
const isValid = bytes => Boolean(bytes && createHash("sha256").update(bytes).digest("hex") === expected);

async function getModel() {
    const cache = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "WF-Art-Designer", "cloth-models");
    const file = path.join(cache, model);
    const cached = await fs.readFile(file).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return null;
    });
    if (isValid(cached)) return cached;
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Could not download clothing model (HTTP ${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!isValid(bytes)) throw new Error("Clothing model SHA-256 does not match the pinned Google model");
    await fs.mkdir(cache, { recursive: true });
    const temporary = file + "." + randomUUID();
    try {
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return bytes;
}

class ClothModelAssets {
    apply(compiler) {
        const name = "ClothModelAssets";
        compiler.hooks.thisCompilation.tap(name, compilation => {
            compilation.hooks.processAssets.tapPromise({
                name, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
            }, async () => {
                const vision = path.dirname(require.resolve("@mediapipe/tasks-vision"));
                const { RawSource } = compiler.webpack.sources;
                const files = [
                    "vision_wasm_internal.js", "vision_wasm_internal.wasm",
                    "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm",
                ];
                const [modelBytes, ...runtime] = await Promise.all([getModel(), ...files.map(file => fs.readFile(path.join(vision, "wasm", file)))]);
                // Adobe local WebView uses file URLs. Its script loader can read
                // packaged resources even when fetch() cannot read local files.
                const emitBytes = (file, bytes) => compilation.emitAsset("cloth-model/" + file + ".packed.js",
                    new RawSource(`window.__wfClothResource=${JSON.stringify(bytes.toString("base64"))};`));
                emitBytes(model, modelBytes);
                files.forEach((file, index) => emitBytes(file, runtime[index]));
                const license = await fs.readFile(path.join(__dirname, "../assets/cloth-model-license.txt"));
                compilation.emitAsset("cloth-model/LICENSE.txt", new RawSource(license));
            });
        });
    }
}

module.exports = ClothModelAssets;

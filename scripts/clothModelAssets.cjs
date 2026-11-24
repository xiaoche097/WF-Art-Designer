const fs = require("node:fs/promises");
const { createHash, randomUUID } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const model = "schp-atr-18-int8-static.onnx";
const expected = "4420d8db8c1f266967c89485786b01209f6d405f320fc0f87e8ced49392cefb5";
const modelUrl = "https://huggingface.co/pirocheto/schp-atr-18/resolve/1ddc548f48cc1435a505e565ff5f56dcfe6017e3/onnx/" + model;
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
    if (!isValid(bytes)) throw new Error("Clothing model SHA-256 does not match the pinned SCHP model");
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
                const runtimeFolder = path.dirname(require.resolve("onnxruntime-web/wasm"));
                const { RawSource } = compiler.webpack.sources;
                const files = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
                const [modelBytes, ...runtime] = await Promise.all([getModel(), ...files.map(file => fs.readFile(path.join(runtimeFolder, file)))]);
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

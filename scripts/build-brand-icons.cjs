const fs = require("node:fs/promises");
const path = require("node:path");
const { Jimp, JimpMime, ResizeStrategy } = require("jimp");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "plugin", "icons");

async function main() {
    const source = await Jimp.read(path.join(root, "assets", "wf-logo.png"));
    if (source.width !== source.height || source.width < 256) {
        throw new Error("请提供至少 256 × 256 的方形 Logo 原图");
    }
    const pngs = new Map();
    const sizes = [16, 23, 24, 32, 46, 48, 64, 128, 256];
    for (const width of sizes) {
        const variant = source.clone().resize({ w: width, h: width, mode: ResizeStrategy.BICUBIC });
        pngs.set(width, await variant.getBuffer(JimpMime.png));
    }
    for (const [name, size] of Object.entries({
        "icon.png": 23,
        "icon@2x.png": 46,
        "icon_24.png": 23,
        "icon_24@1x.png": 23,
        "icon_24@2x.png": 46,
        "wf-brand.png": 256,
    })) {
        await fs.writeFile(path.join(output, name), pngs.get(size));
    }

    const iconSizes = [16, 24, 32, 48, 64, 128, 256];
    const directory = Buffer.alloc(6 + iconSizes.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(iconSizes.length, 4);
    let offset = directory.length;
    const layers = iconSizes.map((size, index) => {
        const png = pngs.get(size);
        const entry = 6 + index * 16;
        directory[entry] = size % 256;
        directory[entry + 1] = size % 256;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(png.length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        offset += png.length;
        return png;
    });
    await fs.writeFile(path.join(output, "icon.ico"), Buffer.concat([directory, ...layers]));
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

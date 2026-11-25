const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const GEMINI_WIDE_RATIOS = [...GEMINI_RATIOS, "1:4", "4:1", "1:8", "8:1"];
const GPT_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
const NANO_BANANA_21_SIZES = ["1K", "2K", "4K"];
const GPT_TIER_RATIOS = ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
const SEEDREAM_50_PIXELS = {
    "1K": { "1:1": "1024x1024", "9:16": "800x1424", "16:9": "1424x800", "3:4": "864x1152", "4:3": "1152x864",
        "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672" },
    "2K": { "1:1": "2048x2048", "9:16": "1584x2816", "16:9": "2816x1584", "3:4": "1776x2368", "4:3": "2368x1776",
        "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
};
const GPT_LONG_EDGE = { "1K": 1024, "2K": 2048, "4K": 3840 };
const RESOLUTION_KEYS = ["supportedResolutions", "supported_resolutions", "supportedImageSizes", "supported_image_sizes",
    "supportedSizes", "supported_sizes", "resolutions", "resolution", "imageSizes", "image_sizes", "sizes", "imageSize", "image_size", "size"];
const RATIO_KEYS = ["supportedAspectRatios", "supported_aspect_ratios", "supportedRatios", "supported_ratios",
    "aspectRatios", "aspect_ratios", "ratios", "aspectRatio", "aspect_ratio"];

function advertisedOptions(sources, keys) {
    for (const source of sources) {
        for (const key of keys) {
            const value = source?.[key];
            const options = Array.isArray(value) ? value : value?.enum ?? value?.options;
            if (Array.isArray(options)) return options;
        }
    }
    return null;
}

const optionValue = item => String(item?.value ?? item?.id ?? item ?? "").trim();
const unique = values => [...new Set(values)];

function dimension(value) {
    return /^([1-9]\d{0,4})\s*[x×]\s*([1-9]\d{0,4})$/i.exec(value);
}

function normalizeSize(item, protocol) {
    const value = optionValue(item);
    const match = dimension(value);
    if (match) return `${match[1]}x${match[2]}`;
    if (protocol === "gemini" && /^(?:\d+(?:\.\d+)?K|512)$/i.test(value)) return value.toUpperCase();
    return "";
}

function sizeRatio(size) {
    const match = dimension(size);
    if (!match) return "";
    const w = Number(match[1]), h = Number(match[2]);
    let a = w, b = h;
    while (b) [a, b] = [b, a % b];
    return `${w / a}:${h / a}`;
}

function documentedOptions(model, protocol) {
    if (protocol === "gemini") {
        if (/^gemini-2\.5-flash-image(?:-preview)?$/i.test(model)) return { sizes: [], ratios: GEMINI_RATIOS };
        if (/^gemini-3-pro-image(?:-preview)?$/i.test(model)) return { sizes: ["1K", "2K", "4K"], ratios: GEMINI_RATIOS };
        if (/^gemini-3\.1-flash-image(?:-preview)?$/i.test(model)) return { sizes: ["512", "1K", "2K", "4K"], ratios: GEMINI_WIDE_RATIOS };
    }
    if (protocol === "openai" && /^gpt-image-(?:1(?:\.5|-mini)?|2(?:-2026-04-21)?)$/i.test(model)) {
        return { sizes: GPT_IMAGE_SIZES, ratios: [] };
    }
    return { sizes: [], ratios: [] };
}

function tierProfile(model, protocol) {
    const name = model.replace(/^zhiying\//i, "");
    if (/^gemini-nano-banana-2\.1$/i.test(name)) {
        return { sizes: NANO_BANANA_21_SIZES, ratios: GEMINI_WIDE_RATIOS,
            openAiSizeMode: protocol === "openai" ? "ratio-and-resolution" : undefined, autoSize: true, autoRatio: true };
    }
    if (/^gpt-image-(?:2(?:-2026-04-21)?|2\.5-(?:sunburst|flare)(?:-2026-09-08)?)$/i.test(name)) {
        return { sizes: Object.keys(GPT_LONG_EDGE), ratios: GPT_TIER_RATIOS,
            openAiSizeMode: protocol === "openai" ? "gpt-pixels" : undefined, autoSize: false, autoRatio: false };
    }
    if (/^doubao-seedream-5-0-pro-260628$/i.test(name)) {
        return { sizes: Object.keys(SEEDREAM_50_PIXELS), ratios: Object.keys(SEEDREAM_50_PIXELS["2K"]),
            openAiSizeMode: protocol === "openai" ? "seedream-pixels" : undefined, autoSize: false, autoRatio: true };
    }
    return null;
}

export function readModelImageOptions(item, model, protocol) {
    const sources = [item?.imageConfig, item?.image_config, item?.capabilities?.image,
        item?.capabilities, item?.parameters?.properties, item?.parameters, item?.options, item];
    const sizes = advertisedOptions(sources, RESOLUTION_KEYS);
    const ratios = advertisedOptions(sources, RATIO_KEYS);
    const profile = tierProfile(model, protocol);
    const sizeField = profile ? advertisedOptions(sources, ["size", "sizes"]) : null;
    const sizeFieldHasRatios = sizeField?.some(item => /^\d+:\d+$/.test(optionValue(item)));
    if (profile && !sizes?.some(item => dimension(optionValue(item)))) {
        const sizeIsRatio = sizes?.length > 0 && sizes.every(item => /^(?:auto|\d+:\d+)$/i.test(optionValue(item)));
        const declaredRatios = ratios ?? (sizeFieldHasRatios ? sizeField : sizeIsRatio ? sizes : null);
        const tiers = sizes === null || sizeIsRatio ? profile.sizes
            : unique(sizes.map(item => normalizeSize(item, "gemini")).filter(value => profile.sizes.includes(value)));
        const aspectRatios = declaredRatios === null ? profile.ratios : normalizeRatios(declaredRatios);
        return { ...profile, sizes: tiers, ratios: aspectRatios.filter(value => profile.ratios.includes(value)), usesTiers: true };
    }
    const documented = documentedOptions(model, protocol);
    const declaredRatioOptions = ratios ?? (sizeFieldHasRatios ? sizeField : null);
    const supportedSizes = sizes === null ? documented.sizes : unique(sizes.map(item => normalizeSize(item, protocol)).filter(Boolean));
    const declaredRatios = declaredRatioOptions === null ? documented.ratios : normalizeRatios(declaredRatioOptions);
    if (protocol === "openai") {
        const allowedRatios = declaredRatioOptions === null ? null : new Set(declaredRatios.map(value => sizeRatio(value.replace(":", "x"))));
        const sizedRatios = supportedSizes.map(sizeRatio);
        return { sizes: supportedSizes, ratios: unique(sizedRatios.filter(value => value && (!allowedRatios || allowedRatios.has(value)))) };
    }
    return { sizes: supportedSizes, ratios: declaredRatios };
}

function normalizeRatios(ratios) {
    return unique(ratios.map(item => optionValue(item).replace(/\s/g, ""))
        .filter(value => /^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(value)));
}

export function resolveModelImageSelection(options, saved, protocol) {
    const { sizes = [], ratios = [] } = options || {};
    const size = sizes.includes(saved?.size) ? saved.size : "";
    const ratio = ratios.includes(saved?.aspectRatio) ? saved.aspectRatio : "";
    if (options?.usesTiers) {
        const { autoSize, autoRatio } = options;
        return { size: size || (autoSize && saved?.size === "" ? "" : sizes.includes("2K") ? "2K" : sizes[0] || ""),
            aspectRatio: ratio || (autoRatio ? "" : ratios[0] || ""), sizes, ratios, autoSize, autoRatio };
    }
    if (protocol !== "openai") return { size, aspectRatio: ratio, sizes, ratios };
    const aspectRatio = ratio || sizeRatio(size);
    const allowedSizes = aspectRatio ? sizes.filter(value => sizeRatio(value) === aspectRatio) : sizes;
    return { size: allowedSizes.includes(size) ? size : (ratio ? allowedSizes[0] || "" : ""),
        aspectRatio, sizes: allowedSizes, ratios };
}

export function openAiImageSizeFields({ size, aspectRatio, openAiSizeMode }) {
    if (openAiSizeMode === "ratio-and-resolution") {
        return { ...(aspectRatio ? { size: aspectRatio } : {}), ...(size ? { resolution: size } : {}) };
    }
    if (openAiSizeMode === "seedream-pixels") {
        const pixels = SEEDREAM_50_PIXELS[size]?.[aspectRatio];
        return size ? { size: pixels || size } : {};
    }
    if (openAiSizeMode === "gpt-pixels") {
        if (!Object.hasOwn(GPT_LONG_EDGE, size)) return {};
        const ratio = GPT_TIER_RATIOS.includes(aspectRatio) ? sizeRatio(aspectRatio.replace(":", "x")) : "1:1";
        const [w, h] = ratio.split(":").map(Number);
        // Scale in 16-pixel increments while keeping the exact ratio and the API's pixel limits.
        const least = Math.ceil(Math.sqrt(655360 / (w * h)) / 16);
        const most = Math.min(Math.floor(3840 / (16 * Math.max(w, h))), Math.floor(Math.sqrt(8294400 / (w * h)) / 16));
        const nominal = Math.round(GPT_LONG_EDGE[size] / (16 * Math.max(w, h)));
        const step = Math.max(least, Math.min(most, nominal)) * 16;
        return { size: `${w * step}x${h * step}` };
    }
    return size ? { size } : {};
}

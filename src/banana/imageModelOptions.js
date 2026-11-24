const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const GEMINI_WIDE_RATIOS = [...GEMINI_RATIOS, "1:4", "4:1", "1:8", "8:1"];
const GPT_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
const RESOLUTION_KEYS = ["supportedResolutions", "supported_resolutions", "supportedImageSizes", "supported_image_sizes",
    "supportedSizes", "supported_sizes", "resolutions", "imageSizes", "image_sizes", "sizes", "imageSize", "image_size", "size"];
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

export function readModelImageOptions(item, model, protocol) {
    const sources = [item?.imageConfig, item?.image_config, item?.capabilities?.image,
        item?.capabilities, item?.parameters?.properties, item?.parameters, item?.options, item];
    const sizes = advertisedOptions(sources, RESOLUTION_KEYS);
    const ratios = advertisedOptions(sources, RATIO_KEYS);
    const documented = documentedOptions(model, protocol);
    const supportedSizes = sizes === null ? documented.sizes : unique(sizes.map(item => normalizeSize(item, protocol)).filter(Boolean));
    const declaredRatios = ratios === null ? documented.ratios
        : unique(ratios.map(item => optionValue(item).replace(/\s/g, "")).filter(value => /^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(value)));
    if (protocol === "openai") {
        const allowedRatios = ratios === null ? null : new Set(declaredRatios.map(value => sizeRatio(value.replace(":", "x"))));
        const sizedRatios = supportedSizes.map(sizeRatio);
        return { sizes: supportedSizes, ratios: unique(sizedRatios.filter(value => value && (!allowedRatios || allowedRatios.has(value)))) };
    }
    return { sizes: supportedSizes, ratios: declaredRatios };
}

export function resolveModelImageSelection(options, saved, protocol) {
    const { sizes = [], ratios = [] } = options || {};
    const size = sizes.includes(saved?.size) ? saved.size : "";
    const ratio = ratios.includes(saved?.aspectRatio) ? saved.aspectRatio : "";
    if (protocol !== "openai") return { size, aspectRatio: ratio, sizes, ratios };
    const aspectRatio = ratio || sizeRatio(size);
    const allowedSizes = aspectRatio ? sizes.filter(value => sizeRatio(value) === aspectRatio) : sizes;
    return { size: allowedSizes.includes(size) ? size : (ratio ? allowedSizes[0] || "" : ""),
        aspectRatio, sizes: allowedSizes, ratios };
}

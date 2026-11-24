const IMAGE_MODEL_ID = /^(?:gpt-image|chatgpt-image|dall-e|dalle|seedream|doubao-seedream|imagen|flux|qwen-image|nano-banana|stable-diffusion|sdxl|kolors|ideogram|recraft|hidream|z-image)(?:[-_.\d]|$)|^gemini-[\w.-]+-image(?:[-_.\d]|$)/i;
const NON_IMAGE_MODEL_ID = /^(?:sora|veo|seedance|doubao-seedance|kling|hailuo|vidu)(?:[-_.\d]|$)|(?:^|[-_.])(?:video|t2v|i2v|v2v|vision|ocr|caption|captioning|embedding|embeddings|understanding|analysis|classifier|moderation|segmentation|rerank)(?:[-_.\d]|$)/i;
const TEXT_MODEL_ID = /^(?:gpt-|gemini-|claude-|deepseek-|qwen[-.\d]|grok-|doubao-)/i;
const IMAGE_OPERATION = /^(?:image|image[_-](?:generation|edit(?:ing)?)|text[_-]to[_-]image|image[_-]to[_-]image|images?\.(?:generations|edits)|generateimage|editimage|t2i|i2i)$/i;

function names(value) {
    return (Array.isArray(value) ? value : [value])
        .map(entry => String(entry?.type ?? entry?.modality ?? entry ?? "").trim().toLowerCase()).filter(Boolean);
}

export function imageModelKind(id, item) {
    const modelName = id.split("/").at(-1);
    if (NON_IMAGE_MODEL_ID.test(modelName)) return "non-image";

    const capabilities = item?.capabilities;
    const outputs = names(item?.outputModalities ?? item?.output_modalities ?? item?.modalities?.output ??
        item?.architecture?.output_modalities ?? capabilities?.outputModalities ?? capabilities?.output_modalities);
    if (outputs.length) {
        const hasVideo = outputs.some(value => value === "video" || value.startsWith("video/"));
        const hasImage = outputs.some(value => value === "image" || value === "images" || value.startsWith("image/"));
        return !hasVideo && hasImage ? "image" : "non-image";
    }
    const tasks = names(item?.tasks ?? item?.task ?? item?.pipeline_tag ?? item?.model_type ??
        item?.type ?? capabilities?.tasks ?? item?.supportedGenerationMethods);
    if (tasks.some(value => /(?:^|[-_])(?:video|embedding|captioning|understanding|ocr)(?:[-_]|$)/.test(value))) return "non-image";
    if (tasks.some(value => IMAGE_OPERATION.test(value)) || capabilities?.image_generation === true ||
        capabilities?.image_edit === true) return "image";
    if (tasks.some(value => /^(?:text|chat|chat_completion|text_generation|text-generation|classification|audio)$/.test(value))) return "non-image";
    if (IMAGE_MODEL_ID.test(modelName)) return "image";
    return TEXT_MODEL_ID.test(modelName) ? "non-image" : "unknown";
}

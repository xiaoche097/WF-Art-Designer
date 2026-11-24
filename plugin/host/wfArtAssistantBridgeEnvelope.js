export function normalizeWfaBridgeRequest(data) {
    if (!data || typeof data !== "object" || !data.id || !data.method) return null;
    return {
        id: data.id,
        method: String(data.method),
        args: Array.isArray(data.args) ? data.args : [],
    };
}

export function serializeWfaBridgeError(err) {
    return {
        message: err?.message || String(err),
        code: err?.code,
        status: err?.status,
        rawBody: err?.rawBody,
        originalMessage: err?.originalMessage,
    };
}

export function createWfaBridgeReply({ id, result, error }) {
    return error ? { id, error } : { id, result };
}

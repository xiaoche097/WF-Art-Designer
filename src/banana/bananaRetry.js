export function bananaCancelled() {
    const error = new Error("已取消");
    error.name = "AbortError";
    return error;
}

export function waitBanana(ms, signal) {
    if (signal?.aborted) return Promise.reject(bananaCancelled());
    return new Promise((resolve, reject) => {
        const cancel = () => {
            clearTimeout(timer);
            reject(bananaCancelled());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", cancel);
            resolve();
        }, ms);
        signal?.addEventListener("abort", cancel, { once: true });
    });
}

export async function retryBananaOperation(operation, { signal, onRetry, wait = waitBanana } = {}) {
    for (let attempt = 1; ; attempt++) {
        if (signal?.aborted) throw bananaCancelled();
        try {
            const result = await operation();
            if (signal?.aborted) throw bananaCancelled();
            return result;
        } catch (error) {
            if (signal?.aborted) throw bananaCancelled();
            if (error?.retryable === false || error?.name === "AbortError") throw error;
            const delayMs = Math.min(60000, 3000 * (2 ** Math.min(attempt - 1, 5)));
            onRetry?.({ attempt, delayMs, error });
            await wait(delayMs, signal);
        }
    }
}

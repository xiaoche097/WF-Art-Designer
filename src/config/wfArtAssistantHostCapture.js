import { readCompatLocalStorage } from "../utils/storageKeyCompat.js";

const HOST_CAPTURE_SETTING_KEY = "wfa_wfArtAssistant_host_capture";
const HOST_CAPTURE_OFF_VALUE = "0";
const SESSION_MARKER_PREFIX = "wfArtAssistant-session:";

export const WF_ART_ASSISTANT_UPLOAD_SESSION_PREFIX = SESSION_MARKER_PREFIX;

function readHostCapturePreference() {
    if (typeof localStorage === "undefined") return null;
    return readCompatLocalStorage(HOST_CAPTURE_SETTING_KEY);
}

function cleanSessionId(value) {
    const text = String(value ?? "").trim();
    return text.length > 0 ? text : null;
}

export function isWfArtAssistantHostCaptureEnabled() {
    try {
        return readHostCapturePreference() !== HOST_CAPTURE_OFF_VALUE;
    } catch {
        return true;
    }
}

export function parseWfArtAssistantUploadSessionToken(value) {
    if (typeof value !== "string") return null;
    const marker = value.trim();
    if (!marker.startsWith(SESSION_MARKER_PREFIX)) return null;
    return cleanSessionId(marker.slice(SESSION_MARKER_PREFIX.length));
}

export function formatWfArtAssistantUploadSessionMarker(sessionId) {
    const id = cleanSessionId(sessionId);
    return id ? `${SESSION_MARKER_PREFIX}${id}` : "";
}

import { crc32Range } from "./wfArtAssistantPngCodec.js";

export const maxCreativeZipBytes = 96 * 1024 * 1024;

export function encodeCreativeZipText(text) {
    const encoded = encodeURIComponent(text).replace(/%([0-9a-f]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)));
    return Uint8Array.from(encoded, character => character.charCodeAt(0));
}

export function createCreativeZip(files) {
    const entries = files.map(({ name, bytes }) => ({ name: encodeCreativeZipText(name), bytes }));
    const dataSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.bytes.length, 0);
    const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
    if (dataSize + centralSize + 22 > maxCreativeZipBytes) throw new Error("套图 ZIP 超过 96 MB");
    const result = new Uint8Array(dataSize + centralSize + 22);
    const view = new DataView(result.buffer);
    const u16 = (offset, value) => view.setUint16(offset, value, true);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    let local = 0;
    let central = dataSize;
    for (const { name, bytes } of entries) {
        const checksum = crc32Range(bytes, 0, bytes.length);
        u32(local, 0x04034b50);
        u16(local + 4, 20);
        u16(local + 6, 0x800);
        u16(local + 12, 0x21);
        u32(local + 14, checksum);
        u32(local + 18, bytes.length);
        u32(local + 22, bytes.length);
        u16(local + 26, name.length);
        result.set(name, local + 30);
        result.set(bytes, local + 30 + name.length);

        u32(central, 0x02014b50);
        u16(central + 4, 20);
        u16(central + 6, 20);
        u16(central + 8, 0x800);
        u16(central + 14, 0x21);
        u32(central + 16, checksum);
        u32(central + 20, bytes.length);
        u32(central + 24, bytes.length);
        u16(central + 28, name.length);
        u32(central + 42, local);
        result.set(name, central + 46);
        local += 30 + name.length + bytes.length;
        central += 46 + name.length;
    }
    u32(central, 0x06054b50);
    u16(central + 8, entries.length);
    u16(central + 10, entries.length);
    u32(central + 12, centralSize);
    u32(central + 16, dataSize);
    return result;
}

export function createWoff2Bytes(size = 64): Uint8Array {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x774f4632, false);
    view.setUint32(8, size, false);
    return bytes;
}

export function createMappedContent(
    options: {
        family?: string;
        sectionFamily?: string;
        bytes?: Uint8Array;
        aroundLink?: readonly [before: string, after: string];
    } = {}
): string {
    const family = options.family || "1";
    const sectionFamily = options.sectionFamily || family;
    const bytes = options.bytes || createWoff2Bytes();
    const fontDataUrl = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`;
    const css = `@font-face { font-family: '${family}'; src: url('${fontDataUrl}') format('woff2'); }`;
    const cssDataUrl = `data:text/css,${encodeURIComponent(css)}`;
    const link = `<link rel="stylesheet" href="${cssDataUrl}">`;
    const [before, after] = options.aroundLink ?? ["", ""];
    return `${before}${link}${after}<section style="font-family: '${sectionFamily}', sans-serif;"><p>合成正文</p></section>`;
}

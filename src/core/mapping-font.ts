import type { Chapter, ChapterMappingFont } from "../types";

export const MAX_CHAPTER_MAPPING_FONT_BYTES = 4 * 1024 * 1024;

export type ChapterMappingKind = "normal" | "mapped";

export interface NormalizedChapterMapping {
    kind: ChapterMappingKind;
    chapter: Chapter;
    changed: boolean;
}

export interface PreparedChapterMappingExport {
    contentHtml: string;
    fontFamily: string;
    font: ChapterMappingFont;
}

export type MappingFontErrorCode =
    | "structure-invalid"
    | "css-invalid"
    | "font-source-invalid"
    | "font-too-large"
    | "woff2-invalid"
    | "hash-mismatch";

export class MappingFontError extends Error {
    constructor(
        readonly code: MappingFontErrorCode,
        message: string
    ) {
        super(message);
        this.name = "MappingFontError";
    }
}

interface ParsedDataUrl {
    mediaType: string;
    bytes: Uint8Array;
}

interface ExtractedMappingFont {
    family: string;
    bytes: Uint8Array;
    contentHtml: string;
}

interface DataCssLinkLocation {
    link: HTMLLinkElement;
    wrapper: HTMLParagraphElement | null;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException("映射字体处理已取消", "AbortError");
    }
}

function parseDataUrl(value: string): ParsedDataUrl {
    if (!value.startsWith("data:")) {
        throw new MappingFontError("font-source-invalid", "映射字体资源不是 data URL");
    }
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) {
        throw new MappingFontError("font-source-invalid", "映射字体 data URL 缺少数据部分");
    }

    const metadata = value.slice(5, commaIndex);
    const parts = metadata.split(";");
    const mediaType = (parts.shift() || "text/plain").toLowerCase();
    const isBase64 = parts.some((part) => part.toLowerCase() === "base64");
    const payload = value.slice(commaIndex + 1);

    try {
        if (isBase64) {
            const decoded = atob(payload.replace(/\s+/g, ""));
            return {
                mediaType,
                bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0))
            };
        }
        return { mediaType, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
    } catch {
        throw new MappingFontError("font-source-invalid", "映射字体 data URL 无法解码");
    }
}

function decodeCssDataUrl(value: string): string {
    const parsed = parseDataUrl(value);
    if (parsed.mediaType !== "text/css") {
        throw new MappingFontError("css-invalid", "映射字体样式不是 text/css");
    }
    return new TextDecoder().decode(parsed.bytes);
}

function getFirstFontFamily(value: string): string {
    const family = value.split(",", 1)[0]?.trim() || "";
    return family.replace(/^(['"])(.*)\1$/, "$2").trim();
}

function getFontFaceBlocks(css: string): string[] {
    return Array.from(css.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi), (match) => match[1]);
}

function getCssFontFamily(block: string): string {
    const match = block.match(/(?:^|;)\s*font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/i);
    return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function getCssFontDataUrl(block: string): string {
    const quoted = block.match(/(?:^|;)\s*src\s*:\s*url\(\s*(['"])(data:[\s\S]*?)\1\s*\)/i);
    if (quoted?.[2]) {
        return quoted[2];
    }
    const unquoted = block.match(/(?:^|;)\s*src\s*:\s*url\(\s*(data:[^)\s]+)\s*\)/i);
    return unquoted?.[1] || "";
}

function createTemplate(contentHtml: string): HTMLTemplateElement {
    const doc = new DOMParser().parseFromString("<!doctype html><html><body></body></html>", "text/html");
    const template = doc.createElement("template");
    template.innerHTML = contentHtml;
    return template;
}

function getDirectElements(template: HTMLTemplateElement): Element[] {
    return Array.from(template.content.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function isDataCssLink(element: Element): element is HTMLLinkElement {
    if (element.tagName !== "LINK") {
        return false;
    }
    const link = element as HTMLLinkElement;
    return (
        link.rel.split(/\s+/).includes("stylesheet") &&
        (link.getAttribute("href") || "").toLowerCase().startsWith("data:text/css")
    );
}

function findDataCssLinkLocations(template: HTMLTemplateElement): {
    signalCount: number;
    locations: DataCssLinkLocation[];
} {
    const links = Array.from(template.content.querySelectorAll("link")).filter(isDataCssLink);
    const locations = links.flatMap<DataCssLinkLocation>((link) => {
        if (link.parentNode === template.content) {
            return [{ link, wrapper: null }];
        }

        const wrapper = link.parentElement;
        if (
            !wrapper ||
            wrapper.tagName !== "P" ||
            wrapper.parentNode !== template.content ||
            wrapper.attributes.length !== 0 ||
            wrapper.children.length !== 1 ||
            wrapper.firstElementChild !== link ||
            Array.from(wrapper.childNodes).some(
                (node) => node !== link && (node.nodeType !== 3 || Boolean(node.textContent?.trim()))
            )
        ) {
            return [];
        }

        return [{ link, wrapper: wrapper as HTMLParagraphElement }];
    });
    return { signalCount: links.length, locations };
}

function findMappedSection(elements: Element[]): HTMLElement[] {
    return elements.filter((element): element is HTMLElement => {
        if (element.tagName !== "SECTION") {
            return false;
        }
        const section = element as HTMLElement;
        const family = getFirstFontFamily(section.style.fontFamily);
        return /^\d+$/.test(family) && Boolean(section.textContent?.trim());
    });
}

function extractMappingFont(contentHtml: string): ExtractedMappingFont | null {
    const template = createTemplate(contentHtml);
    const elements = getDirectElements(template);
    const dataCss = findDataCssLinkLocations(template);
    const mappedSections = findMappedSection(elements);
    const hasMappingSignal = dataCss.signalCount > 0 || mappedSections.length > 0;
    if (!hasMappingSignal) {
        return null;
    }
    if (dataCss.signalCount !== 1 || dataCss.locations.length !== 1 || mappedSections.length !== 1) {
        throw new MappingFontError("structure-invalid", "映射字体章节结构不完整或不唯一");
    }

    const dataCssLocation = dataCss.locations[0];
    const sectionFamily = getFirstFontFamily(mappedSections[0].style.fontFamily);
    const css = decodeCssDataUrl(dataCssLocation.link.getAttribute("href") || "");
    const fontFaceBlocks = getFontFaceBlocks(css);
    if (fontFaceBlocks.length !== 1 || getCssFontFamily(fontFaceBlocks[0]) !== sectionFamily) {
        throw new MappingFontError("css-invalid", "映射字体 family 与正文不匹配");
    }

    const fontDataUrl = getCssFontDataUrl(fontFaceBlocks[0]);
    if (!fontDataUrl) {
        throw new MappingFontError("font-source-invalid", "映射字体样式缺少内嵌字体资源");
    }
    const parsedFont = parseDataUrl(fontDataUrl);
    if (parsedFont.mediaType !== "font/woff2") {
        throw new MappingFontError("font-source-invalid", "映射字体资源不是 font/woff2");
    }

    // 页面 CSS 不进入缓存和导出，仅保留经过校验的字体及正文自身的 family 绑定
    if (dataCssLocation.wrapper) {
        dataCssLocation.wrapper.remove();
    } else {
        dataCssLocation.link.remove();
    }
    return { family: sectionFamily, bytes: parsedFont.bytes, contentHtml: template.innerHTML };
}

function validateWoff2Bytes(bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_CHAPTER_MAPPING_FONT_BYTES) {
        throw new MappingFontError("font-too-large", "映射字体超过 4 MiB 安全上限");
    }
    if (bytes.byteLength < 48) {
        throw new MappingFontError("woff2-invalid", "映射字体小于 WOFF2 头部长度");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, false) !== 0x774f4632) {
        throw new MappingFontError("woff2-invalid", "映射字体缺少 WOFF2 签名");
    }
    if (view.getUint32(8, false) !== bytes.byteLength) {
        throw new MappingFontError("woff2-invalid", "映射字体声明长度与实际长度不一致");
    }
}

async function getSha256(bytes: Uint8Array): Promise<string> {
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hash = await crypto.subtle.digest("SHA-256", source);
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function createMappingFont(family: string, bytes: Uint8Array, signal?: AbortSignal): Promise<ChapterMappingFont> {
    throwIfAborted(signal);
    validateWoff2Bytes(bytes);
    const sha256 = await getSha256(bytes);
    throwIfAborted(signal);
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
        family,
        blob: new Blob([source], { type: "font/woff2" }),
        mediaType: "font/woff2",
        sha256
    };
}

function findNormalizedMappedFamily(contentHtml: string): string | null {
    const template = createTemplate(contentHtml);
    const elements = getDirectElements(template);
    const dataCssLink = elements.some(
        (element) => element.tagName === "LINK" && (element.getAttribute("href") || "").startsWith("data:text/css")
    );
    const mappedSections = findMappedSection(elements);
    if (dataCssLink || mappedSections.length !== 1) {
        return null;
    }
    return getFirstFontFamily(mappedSections[0].style.fontFamily);
}

async function validateStoredMappingFont(
    chapter: Chapter,
    font: ChapterMappingFont,
    signal?: AbortSignal
): Promise<void> {
    if (!/^\d+$/.test(font.family) || font.mediaType !== "font/woff2" || font.blob.type !== "font/woff2") {
        throw new MappingFontError("font-source-invalid", "缓存映射字体元数据无效");
    }
    if (findNormalizedMappedFamily(chapter.content) !== font.family) {
        throw new MappingFontError("structure-invalid", "缓存映射字体与正文 family 不匹配");
    }
    throwIfAborted(signal);
    const bytes = new Uint8Array(await font.blob.arrayBuffer());
    validateWoff2Bytes(bytes);
    const sha256 = await getSha256(bytes);
    throwIfAborted(signal);
    if (sha256 !== font.sha256) {
        throw new MappingFontError("hash-mismatch", "缓存映射字体完整性校验失败");
    }
}

/**
 * 严格识别并规范化新抓取或旧缓存中的章节字体
 * 正常章节保持原样；出现部分映射信号时抛出明确错误，避免静默导出错误正文
 */
export async function normalizeChapterMappingFont(
    chapter: Chapter,
    signal?: AbortSignal
): Promise<NormalizedChapterMapping> {
    throwIfAborted(signal);
    if (chapter.mappingFont) {
        await validateStoredMappingFont(chapter, chapter.mappingFont, signal);
        return { kind: "mapped", chapter, changed: false };
    }

    // 普通缓存通常不含这两个标记，先走快速路径，避免高命中任务重复创建数千个 DOM
    if (!chapter.content.includes("data:text/css") && !/font-family\s*:\s*['"]?\d+/i.test(chapter.content)) {
        return { kind: "normal", chapter, changed: false };
    }

    const extracted = extractMappingFont(chapter.content);
    if (!extracted) {
        return { kind: "normal", chapter, changed: false };
    }
    const mappingFont = await createMappingFont(extracted.family, extracted.bytes, signal);
    return {
        kind: "mapped",
        chapter: { ...chapter, content: extracted.contentHtml, mappingFont },
        changed: true
    };
}

/**
 * 为单个导出文档生成受控且唯一的 family，不复用页面提供的任意 CSS
 */
export function prepareChapterMappingExport(
    chapter: Chapter,
    chapterIndex: number
): PreparedChapterMappingExport | null {
    const font = chapter.mappingFont;
    if (!font) {
        if (chapter.content.includes("data:text/css") || /font-family\s*:\s*['"]?\d+/i.test(chapter.content)) {
            throw new MappingFontError("structure-invalid", `第 ${chapterIndex + 1} 章缺少已校验的映射字体`);
        }
        return null;
    }
    if (
        !/^\d+$/.test(font.family) ||
        font.mediaType !== "font/woff2" ||
        font.blob.type !== "font/woff2" ||
        font.blob.size === 0 ||
        !/^[a-f0-9]{64}$/.test(font.sha256)
    ) {
        throw new MappingFontError("font-source-invalid", `第 ${chapterIndex + 1} 章的映射字体元数据无效`);
    }

    const template = createTemplate(chapter.content);
    const elements = getDirectElements(template);
    const mappedSections = findMappedSection(elements);
    if (mappedSections.length !== 1 || getFirstFontFamily(mappedSections[0].style.fontFamily) !== font.family) {
        throw new MappingFontError("structure-invalid", `第 ${chapterIndex + 1} 章的映射字体与正文不匹配`);
    }
    if (
        elements.some(
            (element) =>
                element.tagName === "LINK" &&
                (element.getAttribute("href") || "").toLowerCase().startsWith("data:text/css")
        )
    ) {
        throw new MappingFontError("structure-invalid", `第 ${chapterIndex + 1} 章仍包含未经校验的页面字体样式`);
    }

    const fontFamily = `esj-mapped-${chapterIndex + 1}-${font.sha256.slice(0, 12)}`;
    const mappedSection = mappedSections[0];
    mappedSection.style.fontFamily = `'${fontFamily}', sans-serif`;

    // ESJZone 原页面使用 lang="en"；若导出文档继承中文 locale，字体的 locl 会让部分源码位回退成错误字形
    // 临时视觉方案必须复现原页面 shaping 环境，并显式关闭地区字形替换，避免不同浏览器或 EPUB 阅读器再次覆盖映射 glyph
    mappedSection.lang = "en";
    mappedSection.style.fontFeatureSettings = '"locl" 0';
    return { contentHtml: template.innerHTML, fontFamily, font };
}

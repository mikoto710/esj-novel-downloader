import { loadScript } from "../utils/index";
import { isSupportedImageMediaType } from "../utils/image-format";
import { escapeXml, convertToXhtml } from "../utils/text";
import { Chapter, BookMetadata, ChapterImage } from "../types";
import { prepareChapterMappingExport } from "./mapping-font";

import type JSZip from "jszip";

function validateChapterImage(image: ChapterImage, chapterIndex: number): void {
    const imageLabel = `第 ${chapterIndex + 1} 章图片 ${image.id}`;
    if (!isSupportedImageMediaType(image.mediaType)) {
        throw new Error(`${imageLabel} 使用了 EPUB 不支持的 MIME: ${image.mediaType}`);
    }
    if (image.blob.size === 0) {
        throw new Error(`${imageLabel} 内容为空`);
    }

    const blobType = image.blob.type.split(";", 1)[0].trim().toLowerCase();
    if (blobType !== image.mediaType) {
        throw new Error(
            `${imageLabel} 的 Blob MIME (${blobType || "unknown"}) 与 manifest MIME (${image.mediaType}) 不一致`
        );
    }
}

/**
 * 封装数据，生成 EPUB 文件
 */
export async function buildEpub(chapters: Chapter[], metadata: BookMetadata, includeTagPage: boolean): Promise<Blob> {
    let ZipClass: new () => JSZip;

    const JSZIP_URLS = [
        "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
        "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"
    ];

    try {
        ZipClass = await loadScript<new () => JSZip>(JSZIP_URLS, "JSZip");
    } catch (e: any) {
        throw new Error("Failed to load JSZip: " + e.message);
    }

    const zip = new ZipClass();
    zip.file("mimetype", "application/epub+zip", { binary: true, compression: "STORE" });

    zip.folder("META-INF")?.file(
        "container.xml",
        `<?xml version="1.0" encoding="utf-8"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>`
    );

    const oebps = zip.folder("OEBPS");
    if (!oebps) {
        throw new Error("Cannot create OEBPS folder in EPUB structure.");
    }

    const manifestItems: string[] = [];
    const spineItems: string[] = [];

    let coverMeta = "";
    if (metadata.coverBlob) {
        const coverFilename = "cover." + metadata.coverExt;
        const coverMime = metadata.coverExt === "png" ? "image/png" : "image/jpeg";

        oebps.file(coverFilename, metadata.coverBlob);
        manifestItems.push(
            `<item id="cover-image" href="${coverFilename}" media-type="${coverMime}" properties="cover-image"/>`
        );
        coverMeta = `<meta name="cover" content="cover-image" />`;
    }

    const tags = metadata.tags || [];
    const shouldIncludeTagPage = includeTagPage && tags.length > 0;
    if (shouldIncludeTagPage) {
        const tagsId = "tags";
        const tagsFilename = "tags.xhtml";
        const tagsList = tags.map((tag) => `<li>${escapeXml(tag)}</li>`).join("\n");
        const tagsXhtml = `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>标签</title></head>
              <body>
                <h1>标签</h1>
                <ul>${tagsList}</ul>
              </body>
            </html>`;

        oebps.file(tagsFilename, tagsXhtml);
        manifestItems.push(`<item id="${tagsId}" href="${tagsFilename}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${tagsId}"/>`);
    }

    let navHtml = `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
          <head><title>目录</title></head>
          <body>
            <nav epub:type="toc" id="toc">
              <h1>目录</h1>
              <ol>
        `;

    if (shouldIncludeTagPage) {
        navHtml += `<li><a href="tags.xhtml">标签</a></li>`;
    }

    for (let i = 0; i < chapters.length; i++) {
        const id = `chap_${i + 1}`;
        const filename = `${id}.xhtml`;
        const title = chapters[i].title || `第${i + 1}章`;
        const mappingExport = prepareChapterMappingExport(chapters[i], i);
        const body = convertToXhtml(mappingExport?.contentHtml || chapters[i].content || "");
        let mappingFontStyle = "";
        if (mappingExport) {
            const fontId = `font_${i + 1}`;
            const fontFilename = `fonts/${fontId}_${mappingExport.font.sha256.slice(0, 12)}.woff2`;
            oebps.file(fontFilename, mappingExport.font.blob);
            manifestItems.push(`<item id="${fontId}" href="${fontFilename}" media-type="font/woff2"/>`);
            mappingFontStyle = `<style>@font-face { font-family: '${mappingExport.fontFamily}'; src: url('${fontFilename}') format('woff2'); font-display: swap; }</style>`;
        }

        // 处理章节中的图片
        const chap = chapters[i];
        if (chap.images && chap.images.length > 0) {
            chap.images.forEach((img) => {
                validateChapterImage(img, i);
                // 写入文件到 OEBPS 根目录
                oebps.file(img.id, img.blob);
                // 添加到 Manifest
                manifestItems.push(
                    `<item id="${img.id.replace(".", "_")}" href="${img.id}" media-type="${img.mediaType}" />`
                );
            });
        }

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>${escapeXml(title)}</title>${mappingFontStyle}</head>
              <body>
                <h2>${escapeXml(title)}</h2>
                <div>${body}</div>
              </body>
            </html>`;

        oebps.file(filename, xhtml);
        manifestItems.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
        spineItems.push(`<itemref idref="${id}"/>`);
        navHtml += `<li><a href="${filename}">${escapeXml(title)}</a></li>`;
    }

    navHtml += `</ol></nav></body></html>`;
    oebps.file("nav.xhtml", navHtml);
    manifestItems.push(`<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`);

    const uniqueId = metadata.uuid || "id-" + Date.now();
    const title = escapeXml(metadata.title || "未知書名");
    const author = escapeXml(metadata.author || "");
    const tagMetadata = tags.map((tag) => `<dc:subject>${escapeXml(tag)}</dc:subject>`).join("\n");
    const pubdate = new Date().toISOString();

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>${title}</dc:title>
            <dc:language>zh-CN</dc:language>
            <dc:identifier id="BookId">${uniqueId}</dc:identifier>
            <dc:creator>${author}</dc:creator>
            <dc:description>${escapeXml(metadata.description || "")}</dc:description>
            ${tagMetadata}
            <dc:date>${pubdate}</dc:date>
            ${coverMeta}
          </metadata>
          <manifest>
            ${manifestItems.join("\n")}
          </manifest>
          <spine>
            ${spineItems.join("\n")}
          </spine>
        </package>`;

    oebps.file("content.opf", contentOpf);

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    return blob;
}

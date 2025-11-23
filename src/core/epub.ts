import { loadScript, log } from '../utils/index';
import { escapeXml, escapeHtmlPreserveLine } from '../utils/text';
import { Chapter, BookMetadata } from '../types';

/**
 * 封装数据，生成 EPUB 文件
 */
export async function buildEpub(chapters: Chapter[], metadata: BookMetadata): Promise<Blob> {
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    if (!window.JSZip) throw new Error("JSZip 未就绪");
  } catch (e: any) {
    throw new Error("加载 JSZip 失败: " + e.message);
  }

  const zip = new window.JSZip();
  zip.file("mimetype", "application/epub+zip", { binary: true, compression: "STORE" });

  zip.folder("META-INF")?.file("container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>`);

  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("无法创建 OEBPS 文件夹");

  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  let coverMeta = "";
  if (metadata.coverBlob) {
    const coverFilename = "cover." + metadata.coverExt;
    const coverMime = metadata.coverExt === "png" ? "image/png" : "image/jpeg";

    oebps.file(coverFilename, metadata.coverBlob);
    manifestItems.push(`<item id="cover-image" href="${coverFilename}" media-type="${coverMime}" properties="cover-image"/>`);
    coverMeta = `<meta name="cover" content="cover-image" />`;
  }

  let navHtml = `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
          <head><title>目录</title></head>
          <body>
            <nav epub:type="toc" id="toc">
              <h1>目录</h1>
              <ol>
        `;

  for (let i = 0; i < chapters.length; i++) {
    const id = `chap_${i + 1}`;
    const filename = `${id}.xhtml`;
    const title = chapters[i].title || (`第${i + 1}章`);
    const body = chapters[i].content || "";

    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>${escapeXml(title)}</title></head>
              <body>
                <h2>${escapeXml(title)}</h2>
                <div>${escapeHtmlPreserveLine(body)}</div>
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

  const uniqueId = metadata.uuid || ("id-" + Date.now());
  const title = escapeXml(metadata.title || "未知書名");
  const author = escapeXml(metadata.author || "");
  const pubdate = new Date().toISOString();

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>${title}</dc:title>
            <dc:language>zh-CN</dc:language>
            <dc:identifier id="BookId">${uniqueId}</dc:identifier>
            <dc:creator>${author}</dc:creator>
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

  log("正在压缩生成 EPUB（可能需要几秒）...");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return blob;
}
import fs from "fs";

export default function getMeta() {
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

    return {
        // 统一基础名称与本地化显示名称，保留命名空间；旧用户通过原条目检查更新升级
        name: "ESJZone 小说下载器",
        "name:zh-CN": "ESJZone 小说下载器",
        "name:zh-TW": "ESJZone 小說下載器",
        namespace: "https://github.com/mikoto710/esj-novel-downloader",
        homepageURL: "https://github.com/mikoto710/esj-novel-downloader",
        supportURL: "https://github.com/mikoto710/esj-novel-downloader/issues",
        version: pkg.version,
        description:
            "下载 ESJZone 小说，支持全本或勾选任意章节后合并导出 TXT、EPUB、HTML，单章支持 TXT、HTML，并提供缓存续传与插图嵌入",
        "description:zh-TW":
            "下載 ESJZone 小說，支援全本或勾選任意章節後合併匯出 TXT、EPUB、HTML，單章支援 TXT、HTML，並提供快取接續下載與插圖嵌入",
        author: "Shigure Sora",
        license: "MIT",
        match: [
            "https://www.esjzone.cc/detail/*",
            "https://www.esjzone.one/detail/*",
            "https://www.esjzone.cc/forum/*",
            "https://www.esjzone.one/forum/*"
        ],
        "run-at": "document-start",
        grant: ["GM_setValue", "GM_getValue", "GM_xmlhttpRequest", "GM_info", "unsafeWindow"],
        connect: [
            "*" // 图片来源域名不固定，允许 GM 跨域请求连接任意域名
        ]
    };
}

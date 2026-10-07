import fs from "fs";

export default function getMeta() {
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

    return {
        // 保留原始名称与命名空间识别已安装脚本，通过本地化字段更新显示名称
        name: "ESJZone 全本下载",
        "name:zh-CN": "ESJZone 小说下载器",
        "name:zh-TW": "ESJZone 小說下載器",
        namespace: "https://github.com/mikoto710/esj-novel-downloader",
        homepageURL: "https://github.com/mikoto710/esj-novel-downloader",
        supportURL: "https://github.com/mikoto710/esj-novel-downloader/issues",
        version: pkg.version,
        description:
            "下载 ESJZone 小说，支持全本与连续章节范围的 TXT、EPUB、HTML 导出，单章支持 TXT、HTML，并提供缓存续传与插图嵌入",
        "description:zh-TW":
            "下載 ESJZone 小說，支援將全本與連續章節範圍匯出為 TXT、EPUB、HTML，單章支援 TXT、HTML，並提供快取接續下載與插圖嵌入",
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

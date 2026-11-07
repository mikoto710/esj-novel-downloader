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
            "ESJZone 小说下载脚本，支持全本下载、自选章节及 TXT、EPUB、HTML 导出",
        "description:zh-TW":
            "ESJZone 小說下載腳本，支援全本下載、自選章節及 TXT、EPUB、HTML 匯出",
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

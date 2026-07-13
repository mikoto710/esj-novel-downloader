import fs from "fs";

export default function getMeta() {
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

    return {
        name: "ESJZone 全本下载",
        namespace: "https://github.com/mikoto710/esj-novel-downloader",
        homepageURL: "https://github.com/mikoto710/esj-novel-downloader",
        supportURL: "https://github.com/mikoto710/esj-novel-downloader/issues",
        version: pkg.version,
        description:
            "在 ESJZone 小说详情页/论坛页注入下载按钮，支持 TXT/EPUB/HTML 全本导出、简介与标签元数据、插图嵌入和单章节导出",
        author: "Shigure Sora",
        license: "MIT",
        match: [
            "https://www.esjzone.cc/detail/*",
            "https://www.esjzone.one/detail/*",
            "https://www.esjzone.cc/forum/*",
            "https://www.esjzone.one/forum/*"
        ],
        "run-at": "document-start",
        grant: ["GM_setValue", "GM_getValue", "GM_xmlhttpRequest", "unsafeWindow"],
        connect: [
            "*" // 允许连接所有图床域名
        ]
        // icon: 'https://www.esjzone.cc/favicon.ico',
    };
}

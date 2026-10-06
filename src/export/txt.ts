import type { Chapter } from "../content/model";

/**
 * 任务就绪前固定简介与原输出范围的 TXT 文本
 */
export function assembleBookTxt(intro: string, chapters: readonly Chapter[]): string {
    return [intro, ...chapters.map((chapter) => chapter.txtSegment)].join("");
}

/**
 * 按现有文件触发时机生成 TXT Blob
 */
export function buildTxt(text: string): Blob {
    return new Blob([text], { type: "text/plain;charset=utf-8" });
}

/**
 * 保留当前单章的书籍简介、作者及页面 URL
 */
export function buildCurrentChapterTxt(input: {
    intro: string | undefined;
    title: string;
    author: string;
    pageUrl: string;
    contentText: string;
}): Blob {
    const metaHeader = input.intro !== undefined ? input.intro + "====================================\n\n" : "";
    return buildTxt(`${metaHeader}${input.title}\n${input.author}\n本章URL: ${input.pageUrl}\n\n${input.contentText}`);
}

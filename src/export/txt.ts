import type { Chapter } from "../content/model";

/**
 * 按传入顺序拼接简介与章节 TXT 片段，不重新选择章节
 */
export function assembleBookTxt(intro: string, chapters: readonly Chapter[]): string {
    return [intro, ...chapters.map((chapter) => chapter.txtSegment)].join("");
}

/**
 * 将已准备的 TXT 文本封装为 UTF-8 Blob
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

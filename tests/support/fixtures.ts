/**
 * 详情页测试夹具选项
 */
export interface DetailPageFixtureOptions {
    bookId?: string;
    bookName?: string;
    coverUrl?: string;
    chapterCount?: number;
}

/**
 * 章节页测试夹具选项
 */
export interface ChapterFixtureOptions {
    title?: string;
    contentHtml?: string;
}

/**
 * 创建小说详情页 DOM 夹具
 */
export function createDetailPageFixture(options: DetailPageFixtureOptions = {}): Document {
    const bookId = options.bookId ?? "100";
    const bookName = options.bookName ?? "测试小说";
    const coverUrl = options.coverUrl ?? "/cover/test.jpg";
    const chapterCount = options.chapterCount ?? 3;
    const chapters = Array.from({ length: chapterCount }, (_, index) => {
        const chapterNumber = index + 1;
        return `<a data-title="第 ${chapterNumber} 章" href="https://www.esjzone.cc/forum/${bookId}/${chapterNumber}.html">第 ${chapterNumber} 章</a>`;
    }).join("");

    const html = `<!doctype html>
        <html>
            <head><title>${escapeFixtureText(bookName)} - ESJZone</title></head>
            <body>
                <div class="sp-buttons"></div>
                <div class="book-detail">
                    <h2 class="text-normal">${escapeFixtureText(bookName)}</h2>
                    <ul class="book-detail"><li>作者：<a>测试作者</a></li></ul>
                </div>
                <div class="product-gallery"><img src="${escapeFixtureAttribute(coverUrl)}"></div>
                <section class="widget-tags"><a class="tag">奇幻</a><a class="tag">冒险</a></section>
                <div id="details"><div class="description"><p>测试简介</p></div></div>
                <div id="chapterList">${chapters}</div>
            </body>
        </html>`;
    return new DOMParser().parseFromString(html, "text/html");
}

/**
 * 创建章节页 HTML 夹具
 */
export function createChapterFixture(options: ChapterFixtureOptions = {}): string {
    const title = options.title ?? "第 1 章";
    const contentHtml = options.contentHtml ?? "<p>章节正文</p>";

    return `<!doctype html>
        <html>
            <head><title>${escapeFixtureText(title)} - ESJZone</title></head>
            <body>
                <h2>${escapeFixtureText(title)}</h2>
                <div class="single-post-meta"><div>章节作者</div></div>
                <article class="forum-content">${contentHtml}</article>
            </body>
        </html>`;
}

/**
 * 创建站点密码章节页 HTML 夹具
 */
export function createProtectedChapterFixture({ title = "第 2 章 密码章节" }: { title?: string } = {}): string {
    return createChapterFixture({
        title,
        contentHtml: `
            <div id="oops">请输入密码</div>
            <input id="pw" name="pw" type="password">
            <button class="btn-send-pw" type="button">送出</button>`
    });
}

/**
 * 将 DOM 夹具安装到当前 jsdom 文档
 */
export function installDocumentFixture(fixture: Document): void {
    document.title = fixture.title;
    document.head.innerHTML = fixture.head.innerHTML;
    document.body.innerHTML = fixture.body.innerHTML;
}

function escapeFixtureText(value: string): string {
    return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function escapeFixtureAttribute(value: string): string {
    return escapeFixtureText(value).replace(/"/g, "&quot;");
}

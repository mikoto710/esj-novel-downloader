export interface DetailPageFixtureOptions {
    bookId?: string;
    bookName?: string;
    author?: string;
    description?: string;
    tags?: string[];
    coverUrl?: string;
    chapterCount?: number;
}

export interface ChapterFixtureOptions {
    title?: string;
    author?: string;
    contentHtml?: string;
}

export function createDetailPageFixture(options: DetailPageFixtureOptions = {}): Document {
    const bookId = options.bookId ?? "100";
    const bookName = options.bookName ?? "测试小说";
    const author = options.author ?? "测试作者";
    const description = options.description ?? "测试简介";
    const tags = options.tags ?? ["奇幻", "冒险"];
    const coverUrl = options.coverUrl ?? "/cover/test.jpg";
    const chapterCount = options.chapterCount ?? 3;
    const chapters = Array.from({ length: chapterCount }, (_, index) => {
        const chapterNumber = index + 1;
        return `<a data-title="第 ${chapterNumber} 章" href="https://www.esjzone.cc/forum/${bookId}/${chapterNumber}.html">第 ${chapterNumber} 章</a>`;
    }).join("");

    return parseHtmlFixture(`<!doctype html>
        <html>
            <head><title>${escapeFixtureText(bookName)} - ESJZone</title></head>
            <body>
                <div class="sp-buttons"></div>
                <div class="book-detail">
                    <h2 class="text-normal">${escapeFixtureText(bookName)}</h2>
                    <ul class="book-detail"><li>作者：<a>${escapeFixtureText(author)}</a></li></ul>
                </div>
                <div class="product-gallery"><img src="${escapeFixtureAttribute(coverUrl)}"></div>
                <section class="widget-tags">${tags.map((tag) => `<a class="tag">${escapeFixtureText(tag)}</a>`).join("")}</section>
                <div id="details"><div class="description"><p>${escapeFixtureText(description)}</p></div></div>
                <div id="chapterList">${chapters}</div>
            </body>
        </html>`);
}

export function createForumPageFixture(bookId = "100"): Document {
    return parseHtmlFixture(`<!doctype html>
        <html>
            <head><title>测试论坛书籍 - ESJZone</title></head>
            <body><main class="forum-list-page" data-book-id="${escapeFixtureAttribute(bookId)}"></main></body>
        </html>`);
}

export function createChapterFixture(options: ChapterFixtureOptions = {}): string {
    const title = options.title ?? "第 1 章";
    const author = options.author ?? "章节作者";
    const contentHtml = options.contentHtml ?? "<p>章节正文</p>";

    return `<!doctype html>
        <html>
            <head><title>${escapeFixtureText(title)} - ESJZone</title></head>
            <body>
                <h2>${escapeFixtureText(title)}</h2>
                <div class="single-post-meta"><div>${escapeFixtureText(author)}</div></div>
                <article class="forum-content">${contentHtml}</article>
            </body>
        </html>`;
}

export function installDocumentFixture(fixture: Document): void {
    document.title = fixture.title;
    document.head.innerHTML = fixture.head.innerHTML;
    document.body.innerHTML = fixture.body.innerHTML;
}

function parseHtmlFixture(html: string): Document {
    if (typeof DOMParser === "undefined") {
        throw new Error("HTML fixtures require the jsdom Vitest environment");
    }
    return new DOMParser().parseFromString(html, "text/html");
}

function escapeFixtureText(value: string): string {
    return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function escapeFixtureAttribute(value: string): string {
    return escapeFixtureText(value).replace(/"/g, "&quot;");
}

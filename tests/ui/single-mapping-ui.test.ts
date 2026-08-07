// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectSinglePageButton } from "../../src/ui/single";
import { setInterfaceLocalePreference } from "../../src/core/config";

function createWoff2Bytes(): Uint8Array {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x774f4632, false);
    view.setUint32(8, bytes.byteLength, false);
    return bytes;
}

function createMappedContent(family = "1"): string {
    const dataUrl = `data:font/woff2;base64,${Buffer.from(createWoff2Bytes()).toString("base64")}`;
    const css = `@font-face { font-family: '${family}'; src: url('${dataUrl}') format('woff2'); }`;
    return `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(css)}"><section style="font-family: '${family}', sans-serif;"><p>Mapped body</p></section>`;
}

function installSinglePage(contentHtml?: string): void {
    document.title = "Test chapter - ESJZone";
    document.body.innerHTML = `
        <nav class="entry-navigation"><a class="view-all">View all</a></nav>
        <div class="customizer-text-switch"><button type="button">原</button></div>
        <h2>Test chapter</h2>
        <div class="single-post-meta"><div>Test author</div></div>
        ${contentHtml === undefined ? "" : `<article class="forum-content">${contentHtml}</article>`}
    `;
}

function getButtons(): { txt: HTMLElement; html: HTMLElement } {
    return {
        txt: document.querySelector("#btn-download-single") as HTMLElement,
        html: document.querySelector("#btn-download-single-html") as HTMLElement
    };
}

describe("single-page mapped font UI", () => {
    beforeEach(() => {
        setInterfaceLocalePreference("zh-CN");
        installSinglePage();
    });

    it("keeps both exports disabled until the chapter DOM is ready", async () => {
        injectSinglePageButton();

        const buttons = getButtons();
        expect(buttons.txt.getAttribute("aria-disabled")).toBe("true");
        expect(buttons.html.getAttribute("aria-disabled")).toBe("true");
        expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("正在检测");

        document.body.insertAdjacentHTML(
            "beforeend",
            `<article class="forum-content">${createMappedContent()}</article>`
        );

        await vi.waitFor(() => {
            expect(buttons.txt.getAttribute("aria-disabled")).toBe("true");
            expect(buttons.html.getAttribute("aria-disabled")).toBe("false");
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("TXT 已禁用");
        });
    });

    it("does not report a partially parsed mapped chapter as invalid during injection", async () => {
        const mappedContent = createMappedContent();
        const template = document.createElement("template");
        template.innerHTML = mappedContent;
        const link = template.content.querySelector("link")!;
        const section = template.content.querySelector("section")!;
        document.body.insertAdjacentHTML("beforeend", '<article class="forum-content"></article>');
        document.querySelector(".forum-content")?.appendChild(link);

        injectSinglePageButton();

        expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("正在检测");
        expect(document.querySelector("#esj-single-mapping-warning")?.textContent).not.toContain("解析失败");
        document.querySelector(".forum-content")?.appendChild(section);

        await vi.waitFor(() => {
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("TXT 已禁用");
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).not.toContain("解析失败");
        });
    });

    it("enables both exports after a normal chapter is fully checked", async () => {
        installSinglePage("<p>Normal body</p>");

        injectSinglePageButton();

        await vi.waitFor(() => {
            const buttons = getButtons();
            expect(buttons.txt.getAttribute("aria-disabled")).toBe("false");
            expect(buttons.html.getAttribute("aria-disabled")).toBe("false");
            expect(document.querySelector("#esj-single-mapping-warning")).toBeNull();
        });
    });

    it("prompts for native password unlock and enables exports after unlock", async () => {
        installSinglePage(`
            <div id="oops">请输入密码</div>
            <input id="pw" name="pw" type="password">
            <button class="btn-send-pw" type="button">送出</button>
        `);

        injectSinglePageButton();

        await vi.waitFor(() => {
            const buttons = getButtons();
            expect(buttons.txt.getAttribute("aria-disabled")).toBe("false");
            expect(buttons.html.getAttribute("aria-disabled")).toBe("false");
            expect(buttons.txt.dataset.esjProtected).toBe("true");
            expect(buttons.html.dataset.esjProtected).toBe("true");
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("请先解锁后再下载");
        });

        getButtons().txt.click();
        expect(document.querySelector("#esj-protected-chapter")).toBeNull();
        expect(document.querySelector("#esj-message-popup")?.textContent).toContain("请先输入密码解锁该章节");
        (document.querySelector("#esj-message-close") as HTMLButtonElement).click();

        document.querySelector(".forum-content")!.innerHTML = "<p>Unlocked body</p>";
        await vi.waitFor(() => {
            const buttons = getButtons();
            expect(buttons.txt.dataset.esjProtected).toBeUndefined();
            expect(buttons.html.dataset.esjProtected).toBeUndefined();
            expect(buttons.txt.getAttribute("title")).toBe("下载本章 (TXT)");
            expect(document.querySelector("#esj-single-mapping-warning")).toBeNull();
        });
    });

    it("keeps both exports disabled when the final mapped structure is invalid", async () => {
        installSinglePage(`<section style="font-family: '1', sans-serif;"><p>Invalid mapped body</p></section>`);

        injectSinglePageButton();

        await vi.waitFor(() => {
            const buttons = getButtons();
            expect(buttons.txt.getAttribute("aria-disabled")).toBe("true");
            expect(buttons.html.getAttribute("aria-disabled")).toBe("true");
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("映射字体解析失败");
        });
    });

    it("rechecks and clears stale warnings after a text customizer switch", async () => {
        installSinglePage(createMappedContent());
        injectSinglePageButton();
        await vi.waitFor(() => {
            expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("TXT 已禁用");
        });

        document.querySelector(".forum-content")!.innerHTML = "<p>Normal body</p>";
        (document.querySelector(".customizer-text-switch button") as HTMLButtonElement).click();

        expect(getButtons().html.getAttribute("aria-disabled")).toBe("true");
        expect(document.querySelector("#esj-single-mapping-warning")?.textContent).toContain("正在检测");
        await vi.waitFor(() => {
            const buttons = getButtons();
            expect(buttons.txt.getAttribute("aria-disabled")).toBe("false");
            expect(buttons.html.getAttribute("aria-disabled")).toBe("false");
            expect(document.querySelectorAll("#esj-single-mapping-warning")).toHaveLength(0);
        });
    });

    it("ignores an older asynchronous mapping result after a newer normal result", async () => {
        installSinglePage(createMappedContent());
        let resolveDigest!: (value: ArrayBuffer) => void;
        const digestPromise = new Promise<ArrayBuffer>((resolve) => {
            resolveDigest = resolve;
        });
        const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => digestPromise);

        try {
            injectSinglePageButton();
            await vi.waitFor(() => expect(digestSpy).toHaveBeenCalledOnce());

            document.querySelector(".forum-content")!.innerHTML = "<p>Newest normal body</p>";
            (document.querySelector(".customizer-text-switch button") as HTMLButtonElement).click();
            await vi.waitFor(() => {
                expect(getButtons().txt.getAttribute("aria-disabled")).toBe("false");
                expect(getButtons().html.getAttribute("aria-disabled")).toBe("false");
            });

            resolveDigest(new Uint8Array(32).buffer);
            await Promise.resolve();
            await Promise.resolve();

            expect(getButtons().txt.getAttribute("aria-disabled")).toBe("false");
            expect(getButtons().html.getAttribute("aria-disabled")).toBe("false");
            expect(document.querySelector("#esj-single-mapping-warning")).toBeNull();
        } finally {
            digestSpy.mockRestore();
        }
    });
});

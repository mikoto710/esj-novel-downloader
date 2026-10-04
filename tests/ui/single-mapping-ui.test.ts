// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectSinglePageButton } from "../../src/ui/pages/single";
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

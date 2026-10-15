// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadDetailBook } from "../../src/site/book";

function directoryDocument(html: string): Document {
    return new DOMParser().parseFromString(
        `<base href="https://www.esjzone.cc/detail/42.html"><div id="chapterList">${html}</div>`,
        "text/html"
    );
}

describe("book directory input", () => {
    it("keeps an exact task mapping through unknown wrappers and folded groups", () => {
        const source = directoryDocument(`<a href="/forum/42/1.html">Intro</a>
            <x-layout><p>Volume</p><details><summary>1–10</summary>
            <a href="/forum/42/2.html">Same title</a><details><summary>Nested</summary><a href="/forum/42/2.html">Same title</a></details>
            </details><details><summary>Empty</summary></details></x-layout>
            <a href="/forum/42/3.html">2.1</a>`);
        const plan = loadDetailBook(source, "https://www.esjzone.cc/detail/42.html");
        expect(plan.directory).toBeDefined();
        const snapshot = new DOMParser().parseFromString(plan.directory.html, "text/html");
        expect(plan.directory.chapterCount).toBe(4);
        expect(
            Array.from(snapshot.querySelectorAll("[data-esj-chapter-index]"), (node) => [
                node.getAttribute("data-esj-chapter-index"),
                node.textContent
            ])
        ).toEqual([
            ["0", "Intro"],
            ["1", "Same title"],
            ["2", "Same title"],
            ["3", "2.1"]
        ]);
        expect(snapshot.querySelectorAll("details")).toHaveLength(3);
        expect(plan.tasks.map(({ index, url }) => [index, url])).toEqual([
            [0, "https://www.esjzone.cc/forum/42/1.html"],
            [1, "https://www.esjzone.cc/forum/42/2.html"],
            [2, "https://www.esjzone.cc/forum/42/2.html"],
            [3, "https://www.esjzone.cc/forum/42/3.html"]
        ]);
    });

    it("isolates source behavior and uses complete chapter text", () => {
        const source = directoryDocument(`<div id="collision" data-esj-chapter-index="90" onclick="bad()">
            <style>body {display:none}</style><script>bad()</script><iframe src="https://example.invalid"></iframe>
            <details open id="duplicate"><summary>Group</summary><a href="/forum/42/1.html" onclick="bad()" data-esj-chapter-index="99" data-title="Truncated">Complete chapter title</a></details>
            </div>`);
        const original = source.querySelector("#chapterList")!.outerHTML;
        const plan = loadDetailBook(source, "https://www.esjzone.cc/detail/42.html");
        expect(plan.directory).toBeDefined();
        const snapshot = new DOMParser().parseFromString(plan.directory.html, "text/html");
        expect(snapshot.querySelector("script,style,iframe,[id],[onclick],[href],[src]")).toBeNull();
        expect(
            Array.from(snapshot.querySelectorAll("[data-esj-chapter-index]"), (node) =>
                node.getAttribute("data-esj-chapter-index")
            )
        ).toEqual(["0"]);
        expect(plan.tasks[0].title).toBe("Complete chapter title");
        expect(source.querySelector("#chapterList")!.outerHTML).toBe(original);
    });
});

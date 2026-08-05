// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
    classifyProtectedChapterResponse,
    createBrowserProtectedChapterAuth,
    extractProtectedChapterToken,
    isProtectedChapterHtml
} from "../../src/adapters/browser-protected-chapter";
import { createChapterFixture, createProtectedChapterFixture } from "../support/fixtures";

const task = {
    index: 1,
    title: "第 2 章 密码章节",
    url: "https://www.esjzone.cc/forum/100/202.html"
};

function textResponse(text: string): Response {
    return { text: vi.fn().mockResolvedValue(text) } as unknown as Response;
}

describe("protected chapter browser protocol", () => {
    it("requires all password markers inside forum content", () => {
        expect(isProtectedChapterHtml(createProtectedChapterFixture())).toBe(true);
        expect(isProtectedChapterHtml(createChapterFixture({ contentHtml: "" }))).toBe(false);
        expect(
            isProtectedChapterHtml(
                createChapterFixture({
                    contentHtml: '<input id="pw" name="pw"><button class="btn-send-pw">send</button>'
                })
            )
        ).toBe(false);
        expect(
            isProtectedChapterHtml(
                `${createChapterFixture()}<div id="oops"></div><input id="pw" name="pw"><button class="btn-send-pw"></button>`
            )
        ).toBe(false);
    });

    it("accepts exactly one non-empty JinJing token", () => {
        expect(extractProtectedChapterToken("<JinJing> token-123 </JinJing>")).toBe("token-123");
        expect(extractProtectedChapterToken("<JinJing></JinJing>")).toBeNull();
        expect(extractProtectedChapterToken("<JinJing>a</JinJing><JinJing>b</JinJing>")).toBeNull();
        expect(extractProtectedChapterToken("token-123")).toBeNull();
    });

    it("classifies successful, rejected, and malformed responses", () => {
        const protectedHtml = createProtectedChapterFixture();
        const unlocked = classifyProtectedChapterResponse(protectedHtml, {
            status: 200,
            html: "<p>解锁后的正文</p>",
            text: "页面元数据"
        });
        expect(unlocked.kind).toBe("unlocked");
        expect(unlocked.kind === "unlocked" && unlocked.html).toContain("解锁后的正文");
        expect(unlocked.kind === "unlocked" && unlocked.html).not.toContain('id="pw"');
        expect(classifyProtectedChapterResponse(protectedHtml, { status: 206, msg: "密码错误", html: "" })).toEqual({
            kind: "password-rejected",
            message: "密码错误"
        });
        expect(classifyProtectedChapterResponse(protectedHtml, { status: 200, html: "" })).toMatchObject({
            kind: "protocol-error",
            code: "content-invalid"
        });
        expect(classifyProtectedChapterResponse(protectedHtml, { status: 599 })).toMatchObject({
            kind: "protocol-error",
            code: "unknown-status"
        });
        expect(classifyProtectedChapterResponse(protectedHtml, null)).toMatchObject({
            kind: "protocol-error",
            code: "response-invalid"
        });
    });

    it("uses the chapter-scoped token request and same-origin password endpoint", async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce(textResponse("<JinJing>fictional-token</JinJing>"))
            .mockResolvedValueOnce(textResponse(JSON.stringify({ status: 200, html: "<p>正文</p>", text: "meta" })));
        const auth = createBrowserProtectedChapterAuth(request);

        const result = await auth.unlock(task, createProtectedChapterFixture(), "R18");

        expect(result.kind).toBe("unlocked");
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[0][0]).toBe(task.url);
        expect(request.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
        expect(String(request.mock.calls[0][1].body)).toBe("plxf=getAuthToken");
        expect(request.mock.calls[1][0]).toBe("https://www.esjzone.cc/inc/forum_pw.php");
        expect(request.mock.calls[1][1].headers).toEqual({
            Authorization: "fictional-token",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        });
        expect(String(request.mock.calls[1][1].body)).toBe("pw=R18");
    });

    it("does not submit a password when the token response is invalid", async () => {
        const request = vi.fn().mockResolvedValue(textResponse("<html>unexpected</html>"));
        const auth = createBrowserProtectedChapterAuth(request);

        await expect(auth.unlock(task, createProtectedChapterFixture(), "secret")).resolves.toMatchObject({
            kind: "protocol-error",
            code: "token-invalid"
        });
        expect(request).toHaveBeenCalledOnce();
    });
});

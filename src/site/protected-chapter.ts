import type {
    ProtectedChapterAuthPort,
    ProtectedChapterProtocolErrorCode,
    ProtectedChapterUnlockResult
} from "../download/contracts";
import { fetchPageText } from "../browser/request";
import { parseInertHtml } from "../browser/html";
import { isCurrentSiteChapter } from "./routes";
import { RequestGate } from "./request-gate";

interface PasswordResponsePayload {
    status: number;
    msg?: string;
    html?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function parseHtml(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
}

function hasProtectedChapterMarkers(document: Document | DocumentFragment): boolean {
    // 三个站点标记必须同时位于正文容器内，避免把普通表单或真正的空正文误判为密码章节
    const content = document.querySelector(".forum-content");
    return Boolean(
        content?.querySelector("#oops") &&
        content.querySelector('input#pw[name="pw"]') &&
        content.querySelector(".btn-send-pw")
    );
}

/**
 * 判断页面正文是否显示密码章节交互
 */
export function isProtectedChapterHtml(html: string): boolean {
    return hasProtectedChapterMarkers(parseInertHtml(html).content);
}

function protocolError(
    code: ProtectedChapterProtocolErrorCode,
    params?: Readonly<Record<string, string | number | boolean>>
): ProtectedChapterUnlockResult {
    return { kind: "protocol-error", code, ...(params ? { params } : {}) };
}

/**
 * 从授权响应提取唯一且非空的 JinJing 令牌，格式不完整时返回 null
 */
export function extractProtectedChapterToken(responseText: string): string | null {
    const matches = Array.from(responseText.matchAll(/<JinJing>([^<]+)<\/JinJing>/g));
    if (matches.length !== 1) {
        return null;
    }
    const token = matches[0][1].trim();
    return token || null;
}

/**
 * 将解锁正文替换到密码章节页面，正文无效、容器缺失或替换后仍受保护时返回 null
 */
export function replaceProtectedChapterContent(pageHtml: string, contentHtml: string): string | null {
    if (!contentHtml.trim()) {
        return null;
    }
    const document = parseHtml(pageHtml);
    const content = document.querySelector(".forum-content");
    if (!content) {
        return null;
    }
    content.innerHTML = contentHtml;
    if (hasProtectedChapterMarkers(document)) {
        return null;
    }
    return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

/**
 * 将站点密码响应归一为解锁、密码拒绝或协议错误结果，并保留 status 206 的站点消息
 */
export function classifyProtectedChapterResponse(pageHtml: string, payload: unknown): ProtectedChapterUnlockResult {
    if (!payload || typeof payload !== "object" || typeof (payload as PasswordResponsePayload).status !== "number") {
        return protocolError("response-invalid");
    }

    const response = payload as PasswordResponsePayload;
    if (response.status === 206) {
        return {
            kind: "password-rejected",
            ...(typeof response.msg === "string" && response.msg.trim() ? { message: response.msg.trim() } : {})
        };
    }
    if (response.status !== 200) {
        return protocolError("unknown-status", { status: response.status });
    }
    if (typeof response.html !== "string") {
        return protocolError("content-invalid");
    }

    const html = replaceProtectedChapterContent(pageHtml, response.html);
    return html ? { kind: "unlocked", html } : protocolError("content-invalid", { stillProtected: true });
}

function parsePasswordResponse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * 创建独占刷新与密码授权端口，密码和令牌仅留在本次请求上下文
 */
export function createProtectedChapterAuth(requestGate: RequestGate = new RequestGate()): ProtectedChapterAuthPort {
    return {
        async unlock(task, password, signal) {
            return requestGate.runExclusive(async () => {
                const chapterUrl = task.url;
                if (!isCurrentSiteChapter(chapterUrl, location.origin)) {
                    throw new Error("Invalid protected chapter target");
                }

                // 由浏览器阻止整个授权链的跳转，密码和令牌只会发给已验证的当前镜像
                const request = (url: string, options?: RequestInit) =>
                    fetchPageText(
                        url,
                        {
                            ...options,
                            credentials: "include",
                            mode: "same-origin",
                            redirect: "error",
                            signal: signal ?? null
                        },
                        REQUEST_TIMEOUT_MS
                    );

                const refreshedPageHtml = await request(chapterUrl, { method: "GET" });
                if (!isProtectedChapterHtml(refreshedPageHtml)) {
                    return { kind: "unlocked", html: refreshedPageHtml };
                }

                const token = extractProtectedChapterToken(
                    await request(chapterUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({ plxf: "getAuthToken" })
                    })
                );
                if (!token) {
                    return protocolError("token-invalid");
                }

                const passwordResponse = await request(new URL("/inc/forum_pw.php", chapterUrl).href, {
                    method: "POST",
                    headers: {
                        Authorization: token,
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest"
                    },
                    body: new URLSearchParams({ pw: password })
                });
                return classifyProtectedChapterResponse(refreshedPageHtml, parsePasswordResponse(passwordResponse));
            }, signal);
        }
    };
}

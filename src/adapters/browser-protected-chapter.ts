import type {
    DownloadTask,
    ProtectedChapterAuthPort,
    ProtectedChapterProtocolErrorCode,
    ProtectedChapterUnlockResult
} from "../core/download/contracts";
import { fetchWithTimeout } from "../utils/index";
import { BrowserRequestGate } from "./browser-request-gate";

type ProtectedChapterRequest = (
    url: string,
    options: RequestInit,
    timeout: number,
    signal?: AbortSignal
) => Promise<Response>;

interface PasswordResponsePayload {
    status: number;
    msg?: string;
    html?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function parseHtml(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
}

function hasProtectedChapterMarkers(document: Document): boolean {
    const content = document.querySelector(".forum-content");
    return Boolean(
        content?.querySelector("#oops") &&
        content.querySelector('input#pw[name="pw"]') &&
        content.querySelector(".btn-send-pw")
    );
}

/**
 * 三个站点标记必须同时位于正文容器内，避免把普通表单或真正的空正文误判为密码章节
 */
export function isProtectedChapterHtml(html: string): boolean {
    return hasProtectedChapterMarkers(parseHtml(html));
}

function protocolError(code: ProtectedChapterProtocolErrorCode, message: string): ProtectedChapterUnlockResult {
    return { kind: "protocol-error", code, message };
}

export function extractProtectedChapterToken(responseText: string): string | null {
    const matches = Array.from(responseText.matchAll(/<JinJing>([^<]+)<\/JinJing>/g));
    if (matches.length !== 1) {
        return null;
    }
    const token = matches[0][1].trim();
    return token || null;
}

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

export function classifyProtectedChapterResponse(pageHtml: string, payload: unknown): ProtectedChapterUnlockResult {
    if (!payload || typeof payload !== "object" || typeof (payload as PasswordResponsePayload).status !== "number") {
        return protocolError("response-invalid", "密码章节响应格式无效");
    }

    const response = payload as PasswordResponsePayload;
    if (response.status === 206) {
        return {
            kind: "password-rejected",
            message: typeof response.msg === "string" && response.msg.trim() ? response.msg.trim() : "密码不正确"
        };
    }
    if (response.status !== 200) {
        return protocolError("unknown-status", `站点返回未知密码状态：${response.status}`);
    }
    if (typeof response.html !== "string") {
        return protocolError("content-invalid", "密码章节正文格式无效");
    }

    const html = replaceProtectedChapterContent(pageHtml, response.html);
    return html ? { kind: "unlocked", html } : protocolError("content-invalid", "密码章节正文为空或仍要求输入密码");
}

function parsePasswordResponse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function createBrowserProtectedChapterAuth(
    request: ProtectedChapterRequest = fetchWithTimeout,
    requestGate: BrowserRequestGate = new BrowserRequestGate()
): ProtectedChapterAuthPort {
    return {
        async unlock(task: DownloadTask, _protectedPageHtml: string, password: string, signal?: AbortSignal) {
            return requestGate.runExclusive(async () => {
                // 只有刷新后的目标章节可以建立本次授权上下文，检测阶段保留的旧页面不得继续参与回填。
                const refreshedResponse = await request(
                    task.url,
                    { method: "GET", credentials: "include" },
                    REQUEST_TIMEOUT_MS,
                    signal
                );
                const refreshedPageHtml = await refreshedResponse.text();
                if (!isProtectedChapterHtml(refreshedPageHtml)) {
                    return { kind: "unlocked", html: refreshedPageHtml };
                }

                const tokenResponse = await request(
                    task.url,
                    {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({ plxf: "getAuthToken" })
                    },
                    REQUEST_TIMEOUT_MS,
                    signal
                );
                const token = extractProtectedChapterToken(await tokenResponse.text());
                if (!token) {
                    return protocolError("token-invalid", "无法取得有效的密码授权 token");
                }

                const passwordResponse = await request(
                    new URL("/inc/forum_pw.php", task.url).toString(),
                    {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            Authorization: token,
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest"
                        },
                        body: new URLSearchParams({ pw: password })
                    },
                    REQUEST_TIMEOUT_MS,
                    signal
                );
                return classifyProtectedChapterResponse(
                    refreshedPageHtml,
                    parsePasswordResponse(await passwordResponse.text())
                );
            }, signal);
        }
    };
}

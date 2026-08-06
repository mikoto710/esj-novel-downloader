import { el } from "../utils/dom";
import { showMessagePopup } from "./message-popup";
import { downloadCurrentPage } from "../scrapers/single";
import { parseChapterHtml } from "../core/parser";
import { MappingFontError, normalizeChapterMappingFont } from "../core/mapping-font";
import { isProtectedChapterHtml } from "../adapters/browser-protected-chapter";

const TXT_TITLE = "下载本章 (TXT)";
const HTML_TITLE = "下载本章 (HTML)";
const MAPPING_CHECK_PENDING = "正在检测章节是否使用映射字体";
const CUSTOMIZER_REFRESH_DELAY_MS = 150;

let mappingUiRefreshVersion = 0;
let mappingUiRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let mappingUiLifecycleInstalled = false;

interface SingleExportElements {
    container: HTMLElement;
    txtButton: HTMLElement;
    htmlButton: HTMLElement;
}

function getSingleExportElements(): SingleExportElements | null {
    const txtButton = document.querySelector("#btn-download-single") as HTMLElement | null;
    const htmlButton = document.querySelector("#btn-download-single-html") as HTMLElement | null;
    const container = txtButton?.parentElement;
    if (!txtButton || !htmlButton || !container) {
        return null;
    }
    return { container, txtButton, htmlButton };
}

function disableSingleExport(button: HTMLElement, reason: string): void {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("title", reason);
    button.style.opacity = "0.5";
    button.style.cursor = "not-allowed";
}

function enableSingleExport(button: HTMLElement, title: string): void {
    delete button.dataset.esjProtected;
    button.setAttribute("aria-disabled", "false");
    button.setAttribute("title", title);
    button.style.opacity = "";
    button.style.cursor = "pointer";
}

function guideSingleProtectedExport(elements: SingleExportElements): void {
    for (const button of [elements.txtButton, elements.htmlButton]) {
        button.dataset.esjProtected = "true";
        button.setAttribute("aria-disabled", "false");
        button.setAttribute("title", "请先在正文区域输入章节密码");
        button.style.opacity = "";
        button.style.cursor = "pointer";
    }
    replaceSingleMappingNotice(elements.container, "🔒 本章需要密码，请先解锁后再下载。", "#a45b00");
}

function replaceSingleMappingNotice(container: HTMLElement, text: string, color: string): void {
    container.querySelector("#esj-single-mapping-warning")?.remove();
    container.appendChild(
        el(
            "span",
            {
                id: "esj-single-mapping-warning",
                style: `display:block;margin-top:8px;color:${color};font-size:12px;line-height:1.5;`
            },
            [text]
        )
    );
}

function showSingleMappingPending(): void {
    const elements = getSingleExportElements();
    if (!elements) {
        return;
    }
    disableSingleExport(elements.txtButton, MAPPING_CHECK_PENDING);
    disableSingleExport(elements.htmlButton, MAPPING_CHECK_PENDING);
    replaceSingleMappingNotice(elements.container, `⏳ ${MAPPING_CHECK_PENDING}...`, "#666");
}

function showSingleMappingFailure(elements: SingleExportElements, reason: string): void {
    disableSingleExport(elements.txtButton, reason);
    disableSingleExport(elements.htmlButton, reason);
    replaceSingleMappingNotice(elements.container, `⚠ ${reason}，已阻止导出。`, "#c62828");
}

async function updateSinglePageMappingUi(version: number): Promise<void> {
    const elements = getSingleExportElements();
    if (!elements) {
        return;
    }
    try {
        if (!document.querySelector(".forum-content")) {
            throw new Error("未找到章节正文，无法完成映射字体检测");
        }
        if (isProtectedChapterHtml(document.documentElement.outerHTML)) {
            if (
                version !== mappingUiRefreshVersion ||
                !elements.txtButton.isConnected ||
                !elements.htmlButton.isConnected
            ) {
                return;
            }
            guideSingleProtectedExport(elements);
            return;
        }
        const parsed = parseChapterHtml(document.documentElement.outerHTML, document.title.split(" - ")[0]);
        const normalized = await normalizeChapterMappingFont({
            title: parsed.title,
            content: parsed.contentHtml,
            txtSegment: `${parsed.title}\n\n${parsed.author}\n\n${parsed.contentText}\n\n`
        });
        if (
            version !== mappingUiRefreshVersion ||
            !elements.txtButton.isConnected ||
            !elements.htmlButton.isConnected
        ) {
            return;
        }
        enableSingleExport(elements.txtButton, TXT_TITLE);
        enableSingleExport(elements.htmlButton, HTML_TITLE);
        elements.container.querySelector("#esj-single-mapping-warning")?.remove();
        if (normalized.kind !== "mapped") {
            return;
        }
        disableSingleExport(elements.txtButton, "映射正文尚未恢复为真实 Unicode，无法生成正确 TXT");
        replaceSingleMappingNotice(
            elements.container,
            "⚠ 本章使用自定义映射字体，TXT 已禁用；HTML 仅保证视觉显示。",
            "#a45b00"
        );
    } catch (error) {
        if (
            version !== mappingUiRefreshVersion ||
            !elements.txtButton.isConnected ||
            !elements.htmlButton.isConnected
        ) {
            return;
        }
        if (error instanceof MappingFontError) {
            showSingleMappingFailure(elements, `映射字体解析失败：${error.message}`);
        } else {
            console.error(error);
            showSingleMappingFailure(
                elements,
                error instanceof Error ? error.message : "映射字体检测失败，请刷新页面重试"
            );
        }
    }
}

function scheduleSinglePageMappingUiRefresh(delayMs = 0): void {
    mappingUiRefreshVersion += 1;
    if (mappingUiRefreshTimer !== null) {
        clearTimeout(mappingUiRefreshTimer);
        mappingUiRefreshTimer = null;
    }
    showSingleMappingPending();
    if (document.readyState === "loading") {
        return;
    }
    const version = mappingUiRefreshVersion;
    mappingUiRefreshTimer = setTimeout(() => {
        mappingUiRefreshTimer = null;
        void updateSinglePageMappingUi(version);
    }, delayMs);
}

function installSinglePageMappingUiLifecycle(): void {
    if (mappingUiLifecycleInstalled) {
        return;
    }
    mappingUiLifecycleInstalled = true;
    document.addEventListener(
        "DOMContentLoaded",
        () => {
            scheduleSinglePageMappingUiRefresh();
        },
        { once: true }
    );
    document.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            if (!(target instanceof Element) || !target.closest(".customizer-text-switch")) {
                return;
            }
            scheduleSinglePageMappingUiRefresh(CUSTOMIZER_REFRESH_DELAY_MS);
        },
        true
    );
    const contentObserver = new MutationObserver((mutations) => {
        const chapterAdded = mutations.some((mutation) =>
            Array.from(mutation.addedNodes).some(
                (node) =>
                    node instanceof Element &&
                    (node.matches(".forum-content") || Boolean(node.querySelector(".forum-content")))
            )
        );
        const waitingForUnlock = Boolean(document.querySelector('[data-esj-protected="true"]'));
        const protectedContentChanged =
            waitingForUnlock &&
            !document.querySelector(
                '.forum-content input#pw[type="password"], .forum-content input[name="pw"][type="password"]'
            ) &&
            mutations.some((mutation) => {
                const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
                return Boolean(target?.closest(".forum-content"));
            });
        if (chapterAdded || protectedContentChanged) {
            scheduleSinglePageMappingUiRefresh();
        }
    });
    contentObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function handleProtectedSingleExport(button: HTMLElement): boolean {
    if (button.dataset.esjProtected !== "true") {
        return false;
    }
    showMessagePopup({
        tone: "warning",
        title: "章节尚未解锁",
        message: "请先输入密码解锁该章节。"
    });
    return true;
}

/**
 * 在单章阅读页注入 "下载本章" 按钮
 */
export function injectSinglePageButton(): void {
    // 定位中间的 column
    const viewAllBtn = document.querySelector(".entry-navigation .view-all");

    if (!viewAllBtn || !viewAllBtn.parentElement) {
        return;
    }

    const container = viewAllBtn.parentElement;

    // 防重复
    if (document.querySelector("#btn-download-single")) {
        installSinglePageMappingUiLifecycle();
        scheduleSinglePageMappingUiRefresh();
        return;
    }

    // 创建 TXT 按钮
    const btnTxt = el(
        "a",
        {
            id: "btn-download-single",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 5px; cursor: pointer;",
            title: TXT_TITLE,
            onclick: (e: Event) => {
                e.preventDefault();
                if (handleProtectedSingleExport(btnTxt)) {
                    return;
                }
                if (btnTxt.getAttribute("aria-disabled") === "true") {
                    showMessagePopup({
                        tone: "warning",
                        title: "TXT 导出不可用",
                        message: btnTxt.getAttribute("title") || "TXT 导出不可用"
                    });
                    return;
                }
                downloadCurrentPage("txt");
            }
        },
        [el("i", { className: "icon-download" })]
    );

    // 创建 HTML 按钮
    const btnHtml = el(
        "a",
        {
            id: "btn-download-single-html",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 10px; cursor: pointer;",
            title: HTML_TITLE,
            onclick: (e: Event) => {
                e.preventDefault();
                if (handleProtectedSingleExport(btnHtml)) {
                    return;
                }
                if (btnHtml.getAttribute("aria-disabled") === "true") {
                    showMessagePopup({
                        tone: "warning",
                        title: "HTML 导出不可用",
                        message: btnHtml.getAttribute("title") || "HTML 导出不可用"
                    });
                    return;
                }
                downloadCurrentPage("html");
            }
        },
        [el("i", { className: "icon-code" })]
    );

    // 插入到 "回整合" 按钮后面
    container.appendChild(btnTxt);
    container.appendChild(btnHtml);
    installSinglePageMappingUiLifecycle();
    scheduleSinglePageMappingUiRefresh();
}

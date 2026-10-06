import { el } from "../../utils/dom";
import { showMessagePopup } from "../dialogs/message";
import { downloadCurrentPage } from "../../scrapers/single";
import { parseChapterHtml, normalizeParsedChapter } from "../../site/chapter";
import { MappingFontError } from "../../content/mapping-font";
import { isProtectedChapterHtml } from "../../site/protected-chapter";
import { bindInterfaceAttribute, subscribeInterfaceLocaleChange, t } from "../locale";
import { formatMappingFontError } from "../messages/mapping-font";

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

/**
 * 保留密码章节按钮入口，并引导用户先在原站解锁
 */
function guideSingleProtectedExport(elements: SingleExportElements): void {
    for (const button of [elements.txtButton, elements.htmlButton]) {
        button.dataset.esjProtected = "true";
        button.setAttribute("aria-disabled", "false");
        button.setAttribute("title", t("protected.single.buttonTitle"));
        button.style.opacity = "";
        button.style.cursor = "pointer";
    }
    replaceSingleMappingNotice(elements.container, t("protected.single.notice"), "#a45b00");
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
    const pending = t("mapping.single.pending");
    disableSingleExport(elements.txtButton, pending);
    disableSingleExport(elements.htmlButton, pending);
    replaceSingleMappingNotice(elements.container, `⏳ ${pending}...`, "#666");
}

function showSingleMappingFailure(elements: SingleExportElements, reason: string): void {
    disableSingleExport(elements.txtButton, reason);
    disableSingleExport(elements.htmlButton, reason);
    replaceSingleMappingNotice(elements.container, t("mapping.single.blocked", { reason }), "#c62828");
}

/**
 * 根据当前正文预检结果更新单章按钮与提示
 */
async function updateSinglePageMappingUi(version: number): Promise<void> {
    const elements = getSingleExportElements();
    if (!elements) {
        return;
    }
    try {
        if (!document.querySelector(".forum-content")) {
            throw new Error(t("single.bodyMissing.message"));
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
        const normalized = await normalizeParsedChapter(parsed);

        // 正文或语言可能在预检期间变化，旧结果不再更新当前工具栏
        if (
            version !== mappingUiRefreshVersion ||
            !elements.txtButton.isConnected ||
            !elements.htmlButton.isConnected
        ) {
            return;
        }
        enableSingleExport(elements.txtButton, t("mapping.single.txtTitle"));
        enableSingleExport(elements.htmlButton, t("mapping.single.htmlTitle"));
        elements.container.querySelector("#esj-single-mapping-warning")?.remove();
        if (normalized.kind !== "mapped") {
            return;
        }
        disableSingleExport(elements.txtButton, t("mapping.single.txtDisabled"));
        replaceSingleMappingNotice(elements.container, t("mapping.single.warning"), "#a45b00");
    } catch (error) {
        if (
            version !== mappingUiRefreshVersion ||
            !elements.txtButton.isConnected ||
            !elements.htmlButton.isConnected
        ) {
            return;
        }
        if (error instanceof MappingFontError) {
            showSingleMappingFailure(
                elements,
                t("mapping.single.failure", { detail: formatMappingFontError(error.code) })
            );
        } else {
            console.error(error);
            showSingleMappingFailure(
                elements,
                error instanceof Error ? error.message : t("mapping.single.failureFallback")
            );
        }
    }
}

/**
 * 合并预检刷新，并使先前异步结果失效
 */
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

    // 正文延迟插入或密码解锁替换内容后，重新判断两个导出按钮的可用性
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
        title: t("protected.single.title"),
        message: t("protected.single.message")
    });
    return true;
}

/**
 * 在单章阅读页注入 TXT、HTML 按钮与预检提示
 */
export function injectSinglePageButton(): void {
    // 复用网站章节导航容器，导出入口与“回整合”放在同一组
    const viewAllBtn = document.querySelector(".entry-navigation .view-all");

    if (!viewAllBtn || !viewAllBtn.parentElement) {
        return;
    }

    const container = viewAllBtn.parentElement;

    // 已有按钮只刷新预检，不重复插入入口
    if (document.querySelector("#btn-download-single")) {
        installSinglePageMappingUiLifecycle();
        scheduleSinglePageMappingUiRefresh();
        return;
    }

    // TXT 按钮受正文与字体预检约束，不可用时展示当前原因
    const btnTxt = el(
        "a",
        {
            id: "btn-download-single",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 5px; cursor: pointer;",
            title: t("mapping.single.txtTitle"),
            onclick: (e: Event) => {
                e.preventDefault();
                if (handleProtectedSingleExport(btnTxt)) {
                    return;
                }
                if (btnTxt.getAttribute("aria-disabled") === "true") {
                    showMessagePopup({
                        tone: "warning",
                        title: t("mapping.single.txtUnavailable"),
                        message: btnTxt.getAttribute("title") || t("mapping.single.txtUnavailable")
                    });
                    return;
                }
                downloadCurrentPage("txt");
            }
        },
        [el("i", { className: "icon-download" })]
    );

    // HTML 使用独立入口，映射字体可由富文本格式携带
    const btnHtml = el(
        "a",
        {
            id: "btn-download-single-html",
            className: "btn btn-outline-secondary view-all",
            style: "margin-left: 10px; cursor: pointer;",
            title: t("mapping.single.htmlTitle"),
            onclick: (e: Event) => {
                e.preventDefault();
                if (handleProtectedSingleExport(btnHtml)) {
                    return;
                }
                if (btnHtml.getAttribute("aria-disabled") === "true") {
                    showMessagePopup({
                        tone: "warning",
                        title: t("mapping.single.htmlUnavailable"),
                        message: btnHtml.getAttribute("title") || t("mapping.single.htmlUnavailable")
                    });
                    return;
                }
                downloadCurrentPage("html");
            }
        },
        [el("i", { className: "icon-code" })]
    );
    bindInterfaceAttribute(btnTxt, "title", "mapping.single.txtTitle");
    bindInterfaceAttribute(btnHtml, "title", "mapping.single.htmlTitle");

    // 按 TXT、HTML 顺序挂载，再启动预检同步按钮状态
    container.appendChild(btnTxt);
    container.appendChild(btnHtml);
    installSinglePageMappingUiLifecycle();
    scheduleSinglePageMappingUiRefresh();
}

subscribeInterfaceLocaleChange(() => {
    if (document.querySelector("#btn-download-single")) {
        scheduleSinglePageMappingUiRefresh();
    }
});

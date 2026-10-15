import { el } from "../dom";
import { t } from "../locale";
import type { ChapterDirectoryMatch } from "./chapter-directory";

interface ChapterSearchOptions {
    search(query: string): readonly ChapterDirectoryMatch[];
    onNavigate(index: number): void;
    getBounds(): { top: number; bottom: number };
}

/**
 * 搜索视图拥有页面监听，调用方移除时须执行 dispose；收起下拉保留输入
 */
export interface ChapterSearchView {
    element: HTMLElement;
    refresh(): void;
    close(): void;
    dispose(): void;
}

/**
 * 展示章节搜索下拉；结果选择只触发导航，不参与下载勾选
 */
export function createChapterSearchView(options: ChapterSearchOptions): ChapterSearchView {
    const input = el("input", {
        id: "esj-range-search",
        type: "search",
        role: "combobox",
        autocomplete: "off",
        "aria-autocomplete": "list",
        "aria-haspopup": "listbox",
        "aria-controls": "esj-chapter-matches",
        "aria-expanded": "false"
    });
    const clear = el("button", { type: "button", className: "esj-search-clear", hidden: true }, ["×"]);

    const count = el("span", { "aria-live": "polite" });
    const hint = el("span");
    const empty = el("div", { className: "esj-search-empty" });
    const list = el("ul", { id: "esj-chapter-matches", role: "listbox" });
    const resultsHeader = el("div", { className: "esj-search-result-header" }, [count, hint]);
    const popup = el("div", { className: "esj-search-results", hidden: true }, [resultsHeader, empty, list]);
    const root = el("div", { className: "esj-selection-search" }, [
        el("div", { className: "esj-search-entry" }, [el("span", { "aria-hidden": "true" }, ["🔎"]), input, clear]),
        popup
    ]);

    let matches: readonly ChapterDirectoryMatch[] = [];
    let position = -1;
    let activeOption: HTMLElement | undefined;
    let composing = false;
    let disposed = false;

    const close = () => {
        popup.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    };

    const setActive = (next: number, scroll = false) => {
        activeOption?.setAttribute("aria-selected", "false");
        position = next;
        const option = list.children.item(next);
        activeOption = option instanceof HTMLElement ? option : undefined;
        if (!activeOption) {
            input.removeAttribute("aria-activedescendant");
            return;
        }

        activeOption.setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", activeOption.id);

        if (scroll) {
            const bounds = list.getBoundingClientRect();
            const target = activeOption.getBoundingClientRect();
            if (target.top < bounds.top || target.height > bounds.height) {
                list.scrollTop -= bounds.top - target.top;
            } else if (target.bottom > bounds.bottom) {
                list.scrollTop += target.bottom - bounds.bottom;
            }
        }
    };

    const renderResults = () => {
        if (disposed) {
            return;
        }

        const activeIndex = matches[position]?.index;
        matches = options.search(input.value);

        list.replaceChildren(
            ...matches.map((match) =>
                el(
                    "li",
                    {
                        id: `esj-chapter-match-${match.index}`,
                        role: "option",
                        "aria-selected": "false",
                        "data-esj-search-index": match.index
                    },
                    [
                        el("span", { className: "esj-search-title" }, [match.title]),
                        el("span", { className: "esj-search-context" }, [
                            t("selection.resultPosition", { index: match.index + 1 }) +
                                (match.context ? ` · ${match.context}` : "")
                        ])
                    ]
                )
            )
        );

        count.textContent = t("selection.matchCount", { count: matches.length });
        hint.textContent = t("selection.searchNavigate");
        empty.textContent = t(input.value.trim() ? "selection.noMatches" : "selection.searchPrompt");
        empty.hidden = matches.length > 0;
        list.hidden = matches.length === 0;
        clear.hidden = !input.value;

        activeOption = undefined;
        const previous = matches.findIndex((match) => match.index === activeIndex);
        setActive(matches.length ? Math.max(0, previous) : -1);
    };

    const open = () => {
        if (disposed) {
            return;
        }

        renderResults();
        resultsHeader.hidden = false;
        popup.removeAttribute("data-compact");
        popup.hidden = false;
        input.setAttribute("aria-expanded", "true");
        const bounds = root.getBoundingClientRect();

        // 下拉可以覆盖目录，但不能挡住弹窗的关闭、取消和下载操作
        const available = options.getBounds();
        const below = Math.max(0, Math.min(window.innerHeight - 12, available.bottom) - bounds.bottom - 5);
        const above = Math.max(0, bounds.top - Math.max(12, available.top) - 5);
        const borderHeight = popup.offsetHeight - popup.clientHeight;
        const headerHeight = resultsHeader.getBoundingClientRect().height;
        const firstResultHeight =
            list.firstElementChild?.getBoundingClientRect().height || empty.getBoundingClientRect().height;
        const contentHeight = list.hidden ? firstResultHeight : Math.min(230, list.scrollHeight);
        const upwards = below < headerHeight + contentHeight + borderHeight && above > below;
        const availableHeight = upwards ? above : below;
        if (availableHeight <= borderHeight) {
            close();
            return;
        }

        // 空间不足时优先显示结果，整个下拉仍受关闭区和底部操作区的边界约束
        popup.toggleAttribute("data-above", upwards);
        popup.toggleAttribute("data-compact", availableHeight < firstResultHeight + borderHeight);
        popup.style.maxHeight = `${availableHeight}px`;
        resultsHeader.hidden = availableHeight < headerHeight + firstResultHeight + borderHeight;
        list.style.maxHeight = `${Math.max(
            0,
            Math.min(230, availableHeight - (resultsHeader.hidden ? 0 : headerHeight) - borderHeight)
        )}px`;
        setActive(position, true);
    };

    const navigate = (index: number) => {
        if (!disposed) {
            close();
            options.onNavigate(index);
        }
    };

    // 输入与键盘导航；中文输入法组合期间不刷新匹配结果
    input.addEventListener("focus", open);
    input.addEventListener("click", () => {
        if (popup.hidden) {
            open();
        }
    });

    input.addEventListener("input", () => {
        if (!composing) {
            position = -1;
            list.scrollTop = 0;
            open();
        }
    });
    input.addEventListener("compositionstart", () => {
        composing = true;
    });
    input.addEventListener("compositionend", () => {
        composing = false;
        position = -1;
        open();
    });

    input.addEventListener("keydown", (event) => {
        // 输入法可能先结束组合再发出确认键，此时仍需忽略 keyCode 229
        if (disposed || composing || event.isComposing || event.keyCode === 229) {
            return;
        }

        if (event.key === "Escape" && !popup.hidden) {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === "Tab") {
            close();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const closed = popup.hidden;
            if (closed) {
                open();
            }
            if (matches.length && !popup.hidden) {
                setActive(
                    closed
                        ? event.key === "ArrowDown"
                            ? 0
                            : matches.length - 1
                        : (position + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length,
                    true
                );
            }
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (popup.hidden) {
                open();
            } else if (matches[position]) {
                navigate(matches[position].index);
            }
        }
    });

    // 鼠标按下结果时保留输入焦点；触屏仍允许原生滑动下拉列表
    list.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") {
            event.preventDefault();
        }
    });
    list.addEventListener("pointermove", (event) => {
        if (disposed || event.pointerType !== "mouse" || !(event.target instanceof Element)) {
            return;
        }
        const option = event.target.closest<HTMLElement>("[data-esj-search-index]");
        if (option && option !== activeOption) {
            setActive(matches.findIndex((match) => match.index === Number(option.dataset.esjSearchIndex)));
        }
    });
    list.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const option = event.target.closest<HTMLElement>("[data-esj-search-index]");
        if (option) {
            navigate(Number(option.dataset.esjSearchIndex));
        }
    });

    clear.addEventListener("click", () => {
        if (!disposed) {
            input.value = "";
            input.focus();
            position = -1;
            open();
        }
    });

    // 外部焦点或页面状态变化只收起下拉，不清空输入
    const onOutsidePointer = (event: PointerEvent) => {
        if (event.target instanceof Node && !root.contains(event.target)) {
            close();
        }
    };
    const onFocusOut = (event: FocusEvent) => {
        if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) {
            close();
        }
    };
    document.addEventListener("pointerdown", onOutsidePointer);
    root.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);

    return {
        element: root,

        /**
         * 刷新界面语言，保留输入与当前结果位置
         */
        refresh() {
            if (disposed) {
                return;
            }

            input.placeholder = t("selection.search");
            input.setAttribute("aria-label", t("selection.search"));
            clear.setAttribute("aria-label", t("selection.clearSearch"));
            list.setAttribute("aria-label", t("selection.searchResults"));
            if (!popup.hidden) {
                open();
            }
        },

        /**
         * 收起下拉，保留查找输入以供再次展开
         */
        close,

        /**
         * 关闭后解除页面监听，旧结果不再触发目录跳转
         */
        dispose() {
            disposed = true;
            close();

            document.removeEventListener("pointerdown", onOutsidePointer);
            root.removeEventListener("focusout", onFocusOut);
            window.removeEventListener("blur", close);
            window.removeEventListener("resize", close);

            matches = [];
            activeOption = undefined;
        }
    };
}

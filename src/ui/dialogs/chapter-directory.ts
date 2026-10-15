import type { DownloadTask } from "../../download/contracts";
import type { BookDirectorySnapshot } from "../../site/book-directory";
import { el } from "../dom";
import { t } from "../locale";

/**
 * 被动目录副本须与任务索引对应，回调给出需勾选或取消的绝对索引
 */
export interface ChapterDirectoryOptions {
    snapshot?: BookDirectorySnapshot;
    tasks: readonly DownloadTask[];
    selectedIndexes: ReadonlySet<number>;
    onSelect(indexes: readonly number[], checked: boolean): void;
}

/**
 * 搜索结果使用从 0 开始的原书绝对索引，目录上下文只用于展示
 */
export interface ChapterDirectoryMatch {
    index: number;
    title: string;
    context: string;
}

/**
 * 固定索引的目录视图，调用方移除时须执行 dispose 释放选择监听和高亮计时
 */
export interface ChapterDirectoryView {
    element: HTMLElement;
    setSelection(indexes: ReadonlySet<number>): void;
    search(query: string): readonly ChapterDirectoryMatch[];
    reveal(index: number): void;
    dispose(): void;
}

/**
 * 固定来源目录与章节身份，勾选、搜索和语言刷新均不重建来源树
 */
export function createChapterDirectoryView(options: ChapterDirectoryOptions): ChapterDirectoryView {
    const root = el("div", { className: "esj-chapter-directory" });
    const positionWidth = `${String(options.tasks.length || 1).length + 1}ch`;
    root.style.setProperty("--esj-chapter-position-width", positionWidth);

    // 快照只来自来源模块生成的被动副本，标记数量与顺序仍需与正式任务核对
    root.innerHTML = options.snapshot?.html || "";
    let nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-esj-chapter-index]"));
    if (
        options.snapshot?.chapterCount !== options.tasks.length ||
        nodes.length !== options.tasks.length ||
        nodes.some((node, order) => node.getAttribute("data-esj-chapter-index") !== String(options.tasks[order].index))
    ) {
        root.replaceChildren(
            ...options.tasks.map((task) => el("div", { "data-esj-chapter-index": task.index }, [task.title]))
        );
        nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-esj-chapter-index]"));
    }

    const rows = new Map<number, { label: HTMLLabelElement; input: HTMLInputElement; title: string }>();
    const groups = new Map<HTMLInputElement, { indexes: readonly number[]; count: HTMLElement; title: string }>();
    const groupTitles = new Map<HTMLDetailsElement, string>();

    let disposed = false;
    let highlighted: HTMLElement | undefined;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;

    // 按固定索引替换章节条目，保留来源目录中的标题内容
    for (const [order, node] of nodes.entries()) {
        const task = options.tasks[order];
        const input = el("input", { type: "checkbox", "data-esj-select-index": task.index });
        const content = el("span", { className: "esj-chapter-name" });
        if (node.textContent?.trim()) {
            content.append(...Array.from(node.childNodes));
        } else {
            content.textContent = task.title;
        }

        const label = el("label", { className: "esj-chapter-row", "data-esj-chapter-index": task.index }, [
            el("span", { className: "esj-chapter-selector" }, [
                input,
                el("span", { className: "esj-chapter-position" }, [`#${task.index + 1}`])
            ]),
            content
        ]);
        node.replaceWith(label);
        rows.set(task.index, { label, input, title: task.title });
    }

    // 只在实际 details 上增加整组选取，不按标题推断卷层级或补造分组
    for (const details of Array.from(root.querySelectorAll("details"))) {
        const summary = Array.from(details.children).find((child) => child.tagName === "SUMMARY");
        if (!summary) {
            continue;
        }
        const title = summary.textContent?.trim() || "";
        groupTitles.set(details, title);
        const indexes = Array.from(
            details.querySelectorAll<HTMLInputElement>("input[data-esj-select-index]"),
            (input) => Number(input.dataset.esjSelectIndex)
        );
        if (!indexes.length) {
            continue;
        }
        const input = el("input", { type: "checkbox" });
        const count = el("span", { className: "esj-chapter-group-count" });
        input.addEventListener("click", (event) => event.stopPropagation());
        summary.prepend(input);
        summary.append(count);
        groups.set(input, { indexes, count, title });
    }

    const entries = Array.from(rows, ([index, row]) => {
        const context: string[] = [];
        for (let parent = row.label.parentElement; parent && parent !== root; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement) {
                const title = groupTitles.get(parent);
                if (title) {
                    context.unshift(title);
                }
            }
        }
        return {
            index,
            title: row.title,
            context: context.join(" / "),
            normalized: row.title.normalize("NFKC").toLocaleLowerCase()
        };
    });

    const onChange = (event: Event) => {
        if (disposed || !(event.target instanceof HTMLInputElement)) {
            return;
        }

        const group = groups.get(event.target);
        if (group) {
            options.onSelect(group.indexes, event.target.checked);
            return;
        }

        const index = Number(event.target.dataset.esjSelectIndex);
        if (rows.get(index)?.input === event.target) {
            options.onSelect([index], event.target.checked);
        }
    };
    root.addEventListener("change", onChange);

    const setSelection = (indexes: ReadonlySet<number>) => {
        if (disposed) {
            return;
        }

        root.setAttribute("aria-label", t("selection.directory"));
        for (const [index, row] of rows) {
            row.input.checked = indexes.has(index);
            row.label.toggleAttribute("data-esj-selected", row.input.checked);
            row.input.setAttribute("aria-label", t("selection.chapterLabel", { index: index + 1, title: row.title }));
        }

        for (const [input, group] of groups) {
            const count = group.indexes.filter((index) => indexes.has(index)).length;
            input.checked = count === group.indexes.length;
            input.indeterminate = count > 0 && count < group.indexes.length;
            input.setAttribute("aria-label", t("selection.selectGroup", { title: group.title }));
            group.count.textContent = `${count} / ${group.indexes.length}`;
        }
    };

    setSelection(options.selectedIndexes);

    return {
        element: root,

        /**
         * 更新勾选和无障碍名称，保留目录折叠、滚动及当前高亮
         */
        setSelection,

        /**
         * 返回带绝对索引的匹配项；精确目录序号优先，不重排原目录
         */
        search(query) {
            const term = query.trim().normalize("NFKC").toLocaleLowerCase();
            if (disposed || !term) {
                return [];
            }

            return entries
                .filter((entry) => String(entry.index + 1) === term || entry.normalized.includes(term))
                .sort(
                    (left, right) => Number(String(right.index + 1) === term) - Number(String(left.index + 1) === term)
                )
                .map(({ index, title, context }) => ({ index, title, context }));
        },

        /**
         * 展开目标的实际祖先并只滚动本目录，导航不修改勾选
         */
        reveal(index) {
            if (disposed) {
                return;
            }

            const target = rows.get(index)?.label;
            if (!target) {
                return;
            }

            clearTimeout(highlightTimer);
            highlighted?.removeAttribute("data-esj-search-current");
            highlighted = target;

            for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
                if (parent instanceof HTMLDetailsElement) {
                    parent.open = true;
                }
            }

            const targetBounds = target.getBoundingClientRect();
            const bounds = root.getBoundingClientRect();
            root.scrollTop +=
                targetBounds.top - bounds.top - Math.max(8, (root.clientHeight - targetBounds.height) / 3);
            target.setAttribute("data-esj-search-current", "");

            highlightTimer = setTimeout(() => {
                target.removeAttribute("data-esj-search-current");
                highlighted = undefined;
            }, 1800);
        },

        /**
         * 关闭后解除选择行为与高亮计时，旧视图不再接收更新
         */
        dispose() {
            disposed = true;
            clearTimeout(highlightTimer);
            root.removeEventListener("change", onChange);

            rows.clear();
            groups.clear();
            groupTitles.clear();
            highlighted = undefined;
        }
    };
}

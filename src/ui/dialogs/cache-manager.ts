import {
    clearAllManagedCaches,
    clearManagedCache,
    listManagedCaches,
    stopAndClearManagedCache
} from "../../app/cache-management";
import type { CacheClearScope, CacheListItem } from "../../app/cache-management";
import { subscribeCacheSync } from "../../storage/cache/sync";
import { el, enableDrag, registerElementCleanup, removeElement } from "../dom";
import { log } from "../../ui/log-view";
import { showMessagePopup } from "./message";
import { subscribeInterfaceLocaleChange, t } from "../locale";
import { acquirePageActionGroupLockForPopup } from "../page-action-lock";
import { createCommonHeader, showDecisionDialog } from "./common";

let disposeActiveCacheManagerSynchronizer: (() => void) | null = null;

function showCacheClearFailure(error: unknown): void {
    showMessagePopup({
        tone: "error",
        title: t("cache.failure.title"),
        message: t("cache.failure.message"),
        details: error instanceof Error ? error.message : String(error)
    });
}

function formatTime(timestamp: number): string {
    if (!timestamp) {
        return "-";
    }
    return new Date(timestamp).toLocaleString();
}

function formatProgress(item: CacheListItem): string {
    if (!item.totalChapters) {
        return `${item.progressCount} / ?`;
    }
    return `${item.progressCount} / ${item.totalChapters}`;
}

function getStatusText(item: CacheListItem): string {
    switch (item.status) {
        case "downloading":
            return t("cache.status.downloading");
        case "cancelled":
            return t("cache.status.cancelled");
        case "export-ready":
            return t("cache.status.exportReady");
        default:
            return t(item.isLegacy ? "cache.status.legacy" : "cache.status.cached");
    }
}

function createBadge(text: string, className = ""): HTMLElement {
    return el("span", { className: `esj-cache-badge ${className}`.trim() }, [text]);
}

function createActionButton(
    text: string,
    onClick: () => Promise<void> | void,
    tone: "default" | "primary" | "danger" = "default"
) {
    return el(
        "button",
        {
            className: `btn btn-sm esj-cache-action esj-cache-action-${tone}`,
            onclick: onClick
        },
        [text]
    );
}

// 确认缓存清理操作，关闭视为取消
function showCacheConfirm(
    owner: HTMLElement,
    options: { title?: string; message: string; danger?: boolean }
): Promise<boolean> {
    return showDecisionDialog({ dismissed: false, owner }, (finish) => {
        const header = createCommonHeader(options.title || t("cache.confirm.title"), () => finish(false));

        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [options.message]);

        const btnCancel = el(
            "button",
            {
                id: "esj-cache-confirm-cancel",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => finish(false)
            },
            [t("common.cancel")]
        );

        const btnOk = el(
            "button",
            {
                id: "esj-cache-confirm-ok",
                style: `padding:8px 12px;${
                    options.danger ? "background:#d9534f;" : "background:#2b9bd7;"
                }color:#fff;border:none;border-radius:6px;cursor:pointer;`,
                onclick: () => finish(true)
            },
            [t("cache.action.clear")]
        );

        const footer = el(
            "div",
            {
                style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;"
            },
            [btnCancel, btnOk]
        );

        return el(
            "div",
            {
                id: "esj-cache-confirm",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [header, body, footer]
        );
    });
}

// 展示活动任务保护或清理结果，等待用户关闭
function showCacheProtectionNotice(owner: HTMLElement, message: string): Promise<void> {
    return showDecisionDialog<void>({ dismissed: undefined, owner }, (finish) => {
        return el(
            "div",
            {
                id: "esj-cache-protection-notice",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("cache.protection.title"), () => finish()),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [message]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;" }, [
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: () => finish()
                        },
                        [t("common.close")]
                    )
                ])
            ]
        );
    });
}

/**
 * 创建缓存管理弹窗
 */
export function createCacheManagerPopup(): void {
    removeElement(document.querySelector("#esj-cache-manager"));
    disposeActiveCacheManagerSynchronizer?.();

    let stopSynchronizing: () => void = () => {};
    let stopLocaleRefresh: () => void = () => {};
    let refreshTimer: number | null = null;
    let disposed = false;

    // 主弹窗统一回收订阅和延迟刷新，重复关闭不影响新实例
    const disposeSynchronizer = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        stopSynchronizing();
        stopLocaleRefresh();
        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        if (disposeActiveCacheManagerSynchronizer === disposeSynchronizer) {
            disposeActiveCacheManagerSynchronizer = null;
        }
    };

    const closeAction = () => {
        removeElement(popup);
    };

    // 卡片列表独立滚动，标题和整页清理操作固定在上下两端
    const listBox = el("div", {
        className: "esj-cache-list",
        style: "flex:1;min-height:0;padding:14px;background:#fafafa;overflow:auto;"
    });

    const footer = el("div", {
        style: "padding:12px;display:flex;justify-content:space-between;gap:8px;border-top:1px solid #eee;background:#fff;border-radius:0 0 8px 8px;"
    });

    const header = createCommonHeader(t("cache.title"), closeAction);
    const popup = el(
        "div",
        {
            id: "esj-cache-manager",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:620px;height:min(520px,calc(100vh - 32px));background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:999999;display:flex;flex-direction:column;"
        },
        [header, listBox, footer]
    );

    // 应用层先筛出活动书籍，存储事务再复核写入任务；界面按清理结果反馈
    async function clearCaches(includeRuntime: boolean): Promise<void> {
        const confirmed = await showCacheConfirm(popup, {
            title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
            message: t(includeRuntime ? "cache.confirm.clearAll" : "cache.confirm.clearPersistent"),
            danger: true
        });
        if (!confirmed) {
            return;
        }
        let result: Awaited<ReturnType<typeof clearAllManagedCaches>>;
        try {
            result = await clearAllManagedCaches(includeRuntime);
        } catch (error) {
            showCacheClearFailure(error);
            return;
        }
        if (result.protectedBookIds.length > 0) {
            await showCacheProtectionNotice(
                popup,
                t("cache.protectedCount", { count: result.protectedBookIds.length })
            );
        }
        log(t("cache.log.clearCompleted"));
        await renderList();
    }

    // 重新读取合并后的缓存列表并重建操作区域
    async function renderList() {
        const items = await listManagedCaches();

        // 数据返回时弹窗可能已关闭，旧结果不再更新界面
        if (!popup.isConnected) {
            return;
        }
        listBox.replaceChildren();
        footer.replaceChildren();

        // 左侧刷新缓存列表，右侧按清理范围分组，活动任务由 app/cache-management 保护
        const leftActions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" });
        const rightActions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" });

        leftActions.appendChild(
            createActionButton(t("cache.action.refresh"), async () => {
                await renderList();
            })
        );

        // 列表为空时也允许重试清理未显示的旧缓存
        rightActions.appendChild(createActionButton(t("cache.action.clearPersistent"), () => clearCaches(false)));
        rightActions.appendChild(createActionButton(t("cache.action.clearAll"), () => clearCaches(true), "danger"));

        footer.append(leftActions, rightActions);

        if (items.length === 0) {
            listBox.appendChild(
                el(
                    "div",
                    {
                        style: "height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;"
                    },
                    [t("cache.empty")]
                )
            );
            return;
        }

        items.forEach((item) => {
            listBox.appendChild(createCacheItem(item, popup, renderList));
        });
    }

    // 合并短时间内的跨页面事件，避免重复渲染
    stopSynchronizing = subscribeCacheSync(() => {
        if (!popup.isConnected) {
            disposeSynchronizer();
            return;
        }
        if (refreshTimer !== null) {
            return;
        }
        refreshTimer = window.setTimeout(() => {
            refreshTimer = null;
            void renderList();
        }, 100);
    });
    disposeActiveCacheManagerSynchronizer = disposeSynchronizer;

    document.body.appendChild(popup);
    registerElementCleanup(popup, disposeSynchronizer);
    acquirePageActionGroupLockForPopup(popup);
    enableDrag(popup, ".esj-common-header");
    stopLocaleRefresh = subscribeInterfaceLocaleChange(() => {
        if (!popup.isConnected) {
            disposeSynchronizer();
            return;
        }
        const listScrollTop = listBox.scrollTop;
        const headerLabel = header.querySelector("span");
        if (headerLabel) {
            headerLabel.textContent = t("cache.title");
        }
        void renderList().then(() => {
            listBox.scrollTop = listScrollTop;
        });
    });
    void renderList();
}

// 按缓存来源和任务状态组装书籍卡片及可用操作
function createCacheItem(item: CacheListItem, popup: HTMLElement, rerender: () => Promise<void>): HTMLElement {
    const badges = createCacheItemBadges(item);
    const progressTrack = createCacheItemProgress(item);
    const actions = createCacheItemActions(item, popup, rerender);

    // 卡片按书籍信息、缓存章节数、状态徽标、进度和操作排列
    const title = el("div", { style: "font-weight:bold;color:#333;word-break:break-word;" }, [item.bookName]);
    const author = el("div", { style: "margin-top:6px;font-size:12px;color:#666;word-break:break-word;" }, [
        t("cache.item.author", { author: item.author || "-", bookId: item.bookId })
    ]);
    const progressSummary = el("div", { style: "margin-top:4px;font-size:12px;color:#666;" }, [
        t("cache.item.progress", { progress: formatProgress(item), time: formatTime(item.updatedAt) })
    ]);
    const source = el("div", { style: "margin-top:4px;font-size:12px;color:#666;word-break:break-word;" }, [
        t("cache.item.source", {
            source: item.sourcePageType,
            url: item.pageUrl ? ` | ${item.pageUrl}` : ""
        })
    ]);
    const content = el("div", { style: "flex:1;min-width:0;" }, [
        title,
        author,
        progressSummary,
        source,
        badges,
        progressTrack,
        actions
    ]);
    const row = el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start;" }, [
        content
    ]);

    return el(
        "div",
        {
            className: "esj-cache-item",
            style: "background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:10px;"
        },
        [row]
    );
}

function createCacheItemBadges(item: CacheListItem): HTMLElement {
    // 徽标分别说明存储来源、任务状态和本页是否已有可导出结果
    const badges = el("div", {
        className: "esj-cache-badges",
        style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"
    });

    if (item.sources.includes("indexeddb")) {
        badges.appendChild(createBadge("IndexedDB"));
    }
    if (item.sources.includes("runtime")) {
        badges.appendChild(createBadge(t("cache.badge.runtime"), "runtime"));
    }
    badges.appendChild(createBadge(getStatusText(item), "status"));
    if (item.activeTask) {
        badges.appendChild(createBadge(t("cache.badge.crossPage"), "runtime"));
    }
    if (item.hasExportData) {
        badges.appendChild(createBadge(t("cache.badge.reexport"), "ready"));
    }
    if (item.isLegacy) {
        badges.appendChild(createBadge(t("cache.status.legacy"), "legacy"));
    }

    return badges;
}

function createCacheItemProgress(item: CacheListItem): HTMLElement {
    const percent =
        item.totalChapters && item.totalChapters > 0
            ? Math.min(100, Math.round((item.progressCount / item.totalChapters) * 100))
            : 0;

    // 以整书章数展示管理进度，分子可包含已处理但未保存的章节
    const progressBar = el("div", { className: "esj-cache-progress-bar", style: `width:${percent}%;` });
    return el(
        "div",
        {
            className: "esj-cache-progress-track",
            style: "margin-top:8px;width:100%;height:10px;background:#e9ecef;border-radius:999px;overflow:hidden;"
        },
        [progressBar]
    );
}

function createCacheItemActions(item: CacheListItem, popup: HTMLElement, rerender: () => Promise<void>): HTMLElement {
    async function clearItem(scope: CacheClearScope): Promise<void> {
        const messageKeys = {
            indexeddb: "cache.confirm.clearIndexedDb",
            runtime: "cache.confirm.clearRuntime",
            all: "cache.confirm.clearItemAll"
        } as const;
        const confirmed = await showCacheConfirm(popup, {
            title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
            message: t(messageKeys[scope], { book: item.bookName }),
            danger: true
        });
        if (!confirmed) {
            return;
        }
        let result: Awaited<ReturnType<typeof clearManagedCache>>;
        try {
            result = await clearManagedCache(item.bookId, scope);
        } catch (error) {
            if (popup.isConnected) {
                showCacheClearFailure(error);
            }
            return;
        }
        if (result.protectedBookIds.length > 0) {
            await showCacheProtectionNotice(popup, t("cache.protected"));
        } else {
            log(t("cache.log.cleared", { book: item.bookName }));
        }
        await rerender();
    }

    async function stopAndClearItem(): Promise<void> {
        const confirmed = await showCacheConfirm(popup, {
            title: `🛑 ${t("cache.action.stopClear")}`,
            message: t("cache.confirm.stopClear", { book: item.bookName }),
            danger: true
        });
        if (!confirmed) {
            return;
        }

        // 发出停止请求不等于清理完成，以实际结果展示提示
        const result = await stopAndClearManagedCache(item.bookId);
        const resultMessage: Record<typeof result.status, string> = {
            "not-active": t("cache.stop.notActive"),
            cleared: t("cache.stop.cleared"),
            "cleanup-failed": t("cache.stop.cleanupFailed"),
            replaced: t("cache.stop.replaced"),
            stale: t("cache.stop.stale"),
            timeout: t("cache.stop.timeout")
        };
        await showCacheProtectionNotice(popup, resultMessage[result.status]);
        await rerender();
    }

    // 活动任务只提供停止并清除，空闲记录才按持久或本页来源清理
    const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;" });
    if (item.activeTask) {
        actions.appendChild(createActionButton(t("cache.action.stopClear"), stopAndClearItem, "danger"));
    } else if (item.sources.includes("indexeddb")) {
        actions.appendChild(createActionButton(t("cache.action.clearIndexedDb"), () => clearItem("indexeddb")));
    }

    if (!item.activeTask && item.sources.includes("runtime")) {
        actions.appendChild(createActionButton(t("cache.action.clearRuntime"), () => clearItem("runtime")));
    }

    if (!item.activeTask && item.sources.length > 1) {
        actions.appendChild(createActionButton(t("cache.action.clearItemAll"), () => clearItem("all"), "danger"));
    }

    return actions;
}

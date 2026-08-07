import {
    clearAllManagedCaches,
    clearManagedCache,
    listManagedCaches,
    stopAndClearManagedCache
} from "../core/cache/manager";
import { CacheListItem } from "../types";
import { subscribeCacheSync } from "../core/cache/sync";
import { el, enableDrag } from "../utils/dom";
import { showMessagePopup } from "./message-popup";
import { t } from "./locale";

let disposeActiveCacheManagerSynchronizer: (() => void) | null = null;

function showCacheClearFailure(error: unknown): void {
    showMessagePopup({
        tone: "error",
        title: t("cache.failure.title"),
        message: t("cache.failure.message"),
        details: error instanceof Error ? error.message : String(error)
    });
}

function toggleSettingsLock(locked: boolean) {
    const buttons = document.querySelectorAll(".esj-settings-trigger");
    buttons.forEach((button) => ((button as HTMLButtonElement).disabled = locked));
}

function createHeader(title: string, onClose: () => void): HTMLElement {
    return el(
        "div",
        {
            className: "esj-common-header",
            style: "padding:10px;background:#2b9bd7;color:#fff;display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:8px 8px 0 0;"
        },
        [
            el("span", { style: "font-weight:bold;" }, [title]),
            el("div", { style: "display:flex;" }, [
                el(
                    "button",
                    {
                        title: t("common.close"),
                        style: "border:none;background:#ef5350;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:bold;",
                        onclick: onClose
                    },
                    ["✕"]
                )
            ])
        ]
    );
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

// 显示缓存清理确认弹窗
function showCacheConfirm(options: { title?: string; message: string; danger?: boolean }): Promise<boolean> {
    document.querySelector("#esj-cache-confirm")?.remove();

    return new Promise((resolve) => {
        const cleanup = (result: boolean) => {
            popup.remove();
            resolve(result);
        };

        const header = createHeader(options.title || t("cache.confirm.title"), () => cleanup(false));

        const body = el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [options.message]);

        const btnCancel = el(
            "button",
            {
                id: "esj-cache-confirm-cancel",
                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                onclick: () => cleanup(false)
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
                onclick: () => cleanup(true)
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

        const popup = el(
            "div",
            {
                id: "esj-cache-confirm",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [header, body, footer]
        );

        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
    });
}

// 显示活动任务保护或清理结果
function showCacheProtectionNotice(message: string): Promise<void> {
    document.querySelector("#esj-cache-protection-notice")?.remove();

    return new Promise((resolve) => {
        const cleanup = () => {
            popup.remove();
            resolve();
        };

        const popup = el(
            "div",
            {
                id: "esj-cache-protection-notice",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:380px;background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:1000000;display:flex;flex-direction:column;"
            },
            [
                createHeader(t("cache.protection.title"), cleanup),
                el("div", { style: "padding:16px;font-size:14px;line-height:1.7;color:#333;" }, [message]),
                el("div", { style: "padding:12px;display:flex;justify-content:flex-end;" }, [
                    el(
                        "button",
                        {
                            style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                            onclick: cleanup
                        },
                        [t("common.close")]
                    )
                ])
            ]
        );

        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
    });
}

/**
 * 创建缓存管理弹窗
 */
export function createCacheManagerPopup(): void {
    disposeActiveCacheManagerSynchronizer?.();
    document.querySelector("#esj-cache-manager")?.remove();
    document.querySelector("#esj-cache-confirm")?.remove();
    toggleSettingsLock(true);

    let stopSynchronizing: () => void = () => {};
    let refreshTimer: number | null = null;
    const disposeSynchronizer = () => {
        stopSynchronizing();
        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        if (disposeActiveCacheManagerSynchronizer === disposeSynchronizer) {
            disposeActiveCacheManagerSynchronizer = null;
        }
    };

    const closeAction = () => {
        disposeSynchronizer();
        document.querySelector("#esj-cache-confirm")?.remove();
        document.querySelector("#esj-cache-manager")?.remove();
        toggleSettingsLock(false);
    };

    const listBox = el("div", {
        className: "esj-cache-list",
        style: "flex:1;min-height:0;padding:14px;background:#fafafa;overflow:auto;"
    });

    const footer = el("div", {
        style: "padding:12px;display:flex;justify-content:space-between;gap:8px;border-top:1px solid #eee;background:#fff;border-radius:0 0 8px 8px;"
    });

    const popup = el(
        "div",
        {
            id: "esj-cache-manager",
            style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:620px;height:min(520px,calc(100vh - 32px));background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,0.28);z-index:999999;display:flex;flex-direction:column;"
        },
        [createHeader(t("cache.title"), closeAction), listBox, footer]
    );

    // 重新读取合并后的缓存列表并重建操作区域
    async function renderList() {
        const items = await listManagedCaches();
        listBox.replaceChildren();
        footer.replaceChildren();

        const leftActions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" });
        const rightActions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" });

        leftActions.appendChild(
            createActionButton(t("cache.action.refresh"), async () => {
                await renderList();
            })
        );

        if (items.length > 0) {
            rightActions.appendChild(
                createActionButton(t("cache.action.clearPersistent"), async () => {
                    const confirmed = await showCacheConfirm({
                        title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
                        message: t("cache.confirm.clearPersistent"),
                        danger: true
                    });
                    if (!confirmed) {
                        return;
                    }
                    let result: Awaited<ReturnType<typeof clearAllManagedCaches>>;
                    try {
                        result = await clearAllManagedCaches(false);
                    } catch (error) {
                        showCacheClearFailure(error);
                        return;
                    }
                    if (result.protectedBookIds.length > 0) {
                        await showCacheProtectionNotice(
                            t("cache.protectedCount", { count: result.protectedBookIds.length })
                        );
                    }
                    await renderList();
                })
            );

            rightActions.appendChild(
                createActionButton(
                    t("cache.action.clearAll"),
                    async () => {
                        const confirmed = await showCacheConfirm({
                            title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
                            message: t("cache.confirm.clearAll"),
                            danger: true
                        });
                        if (!confirmed) {
                            return;
                        }
                        let result: Awaited<ReturnType<typeof clearAllManagedCaches>>;
                        try {
                            result = await clearAllManagedCaches(true);
                        } catch (error) {
                            showCacheClearFailure(error);
                            return;
                        }
                        if (result.protectedBookIds.length > 0) {
                            await showCacheProtectionNotice(
                                t("cache.protectedCount", { count: result.protectedBookIds.length })
                            );
                        }
                        await renderList();
                    },
                    "danger"
                )
            );
        }

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
            listBox.appendChild(createCacheItem(item, renderList));
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
    enableDrag(popup, ".esj-common-header");
    void renderList();
}

// 根据活动任务和缓存来源生成可用操作
function createCacheItem(item: CacheListItem, rerender: () => Promise<void>): HTMLElement {
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

    const percent =
        item.totalChapters && item.totalChapters > 0
            ? Math.min(100, Math.round((item.progressCount / item.totalChapters) * 100))
            : 0;

    const progressBar = el("div", { className: "esj-cache-progress-bar", style: `width:${percent}%;` });
    const progressTrack = el(
        "div",
        {
            className: "esj-cache-progress-track",
            style: "margin-top:8px;width:100%;height:10px;background:#e9ecef;border-radius:999px;overflow:hidden;"
        },
        [progressBar]
    );

    const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;" });

    if (item.activeTask) {
        actions.appendChild(
            createActionButton(
                t("cache.action.stopClear"),
                async () => {
                    const confirmed = await showCacheConfirm({
                        title: `🛑 ${t("cache.action.stopClear")}`,
                        message: t("cache.confirm.stopClear", { book: item.bookName }),
                        danger: true
                    });
                    if (!confirmed) {
                        return;
                    }

                    const result = await stopAndClearManagedCache(item.bookId);
                    const resultMessage: Record<typeof result.status, string> = {
                        "not-active": t("cache.stop.notActive"),
                        cleared: t("cache.stop.cleared"),
                        "cleanup-failed": t("cache.stop.cleanupFailed"),
                        replaced: t("cache.stop.replaced"),
                        stale: t("cache.stop.stale"),
                        timeout: t("cache.stop.timeout")
                    };
                    await showCacheProtectionNotice(resultMessage[result.status]);
                    await rerender();
                },
                "danger"
            )
        );
    } else if (item.sources.includes("indexeddb")) {
        actions.appendChild(
            createActionButton(t("cache.action.clearIndexedDb"), async () => {
                const confirmed = await showCacheConfirm({
                    title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
                    message: t("cache.confirm.clearIndexedDb", { book: item.bookName }),
                    danger: true
                });
                if (!confirmed) {
                    return;
                }
                const result = await clearManagedCache(item.bookId, "indexeddb");
                if (result.protectedBookIds.length > 0) {
                    await showCacheProtectionNotice(t("cache.protected"));
                }
                await rerender();
            })
        );
    }

    if (!item.activeTask && item.sources.includes("runtime")) {
        actions.appendChild(
            createActionButton(t("cache.action.clearRuntime"), async () => {
                const confirmed = await showCacheConfirm({
                    title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
                    message: t("cache.confirm.clearRuntime", { book: item.bookName }),
                    danger: true
                });
                if (!confirmed) {
                    return;
                }
                const result = await clearManagedCache(item.bookId, "runtime");
                if (result.protectedBookIds.length > 0) {
                    await showCacheProtectionNotice(t("cache.protected"));
                }
                await rerender();
            })
        );
    }

    if (!item.activeTask && item.sources.length > 1) {
        actions.appendChild(
            createActionButton(
                t("cache.action.clearItemAll"),
                async () => {
                    const confirmed = await showCacheConfirm({
                        title: `🗑️ ${t("cache.action.clear")}${t("common.confirm")}`,
                        message: t("cache.confirm.clearItemAll", { book: item.bookName }),
                        danger: true
                    });
                    if (!confirmed) {
                        return;
                    }
                    const result = await clearManagedCache(item.bookId, "all");
                    if (result.protectedBookIds.length > 0) {
                        await showCacheProtectionNotice(t("cache.protected"));
                    }
                    await rerender();
                },
                "danger"
            )
        );
    }

    return el(
        "div",
        {
            className: "esj-cache-item",
            style: "background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:10px;"
        },
        [
            el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start;" }, [
                el("div", { style: "flex:1;min-width:0;" }, [
                    el("div", { style: "font-weight:bold;color:#333;word-break:break-word;" }, [item.bookName]),
                    el("div", { style: "margin-top:6px;font-size:12px;color:#666;word-break:break-word;" }, [
                        t("cache.item.author", { author: item.author || "-", bookId: item.bookId })
                    ]),
                    el("div", { style: "margin-top:4px;font-size:12px;color:#666;" }, [
                        t("cache.item.progress", { progress: formatProgress(item), time: formatTime(item.updatedAt) })
                    ]),
                    el("div", { style: "margin-top:4px;font-size:12px;color:#666;word-break:break-word;" }, [
                        t("cache.item.source", {
                            source: item.sourcePageType,
                            url: item.pageUrl ? ` | ${item.pageUrl}` : ""
                        })
                    ]),
                    badges,
                    progressTrack,
                    actions
                ])
            ])
        ]
    );
}

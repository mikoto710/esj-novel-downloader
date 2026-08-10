import type { IncompleteChapterDecision, IncompleteChapterDetection } from "../../core/download/contracts";
import { enableDrag, el } from "../../utils/dom";
import { createCommonHeader } from "./common";
import { t } from "../locale";

/**
 * 自动补抓和持久化后仍存在缺章时，要求用户选择再次补抓、使用占位导出或取消
 */
export function confirmIncompleteChapters(
    detection: IncompleteChapterDetection,
    signal?: AbortSignal
): Promise<IncompleteChapterDecision> {
    document.querySelector("#esj-incomplete-chapters")?.remove();
    if (signal?.aborted) {
        return Promise.resolve("cancel");
    }

    return new Promise<IncompleteChapterDecision>((resolve) => {
        let settled = false;
        const abortListener = () => finish("cancel");

        const preview = detection.missingTasks.slice(0, 10).map((task) =>
            el("li", { style: "margin-bottom:8px;" }, [
                el("div", { style: "font-weight:bold;color:#333;" }, [
                    detection.selectionMode === "range"
                        ? t("download.missing.rangePosition", {
                              index: (detection.taskOrderByIndex?.get(task.index) ?? 0) + 1,
                              total: detection.totalChapters,
                              sourceIndex: task.index + 1
                          }) + ` ${task.title}`
                        : `[${task.index + 1}/${detection.totalChapters}] ${task.title}`
                ]),
                el("div", { style: "color:#666;font-size:12px;overflow-wrap:anywhere;" }, [task.url])
            ])
        );
        if (detection.missingTasks.length > preview.length) {
            preview.push(
                el("li", { style: "color:#8a5a00;" }, [
                    t("download.missing.remaining", { count: detection.missingTasks.length - preview.length })
                ])
            );
        }

        const popup = el(
            "div",
            {
                id: "esj-incomplete-chapters",
                role: "alertdialog",
                "aria-modal": "true",
                style: "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);background:#fff;border:1px solid #aaa;border-radius:8px;box-shadow:0 0 18px rgba(0,0,0,.28);z-index:1000001;display:flex;flex-direction:column;"
            },
            [
                createCommonHeader(t("download.missing.title"), () => finish("cancel")),
                el("div", { style: "padding:16px;font-size:15px;line-height:1.7;min-height:0;overflow:auto;" }, [
                    el(
                        "div",
                        {
                            style: "padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;"
                        },
                        [t("download.missing.message", { count: detection.missingTasks.length })]
                    ),
                    el("ol", { style: "margin:12px 0 0;padding-left:28px;" }, preview)
                ]),
                el(
                    "div",
                    {
                        style: "padding:12px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;"
                    },
                    [
                        el(
                            "button",
                            {
                                id: "esj-incomplete-cancel",
                                style: "padding:8px 12px;background:#eee;border:1px solid #ccc;border-radius:6px;cursor:pointer;",
                                onclick: () => finish("cancel")
                            },
                            [t("download.action.cancelKeepCache")]
                        ),
                        el(
                            "button",
                            {
                                id: "esj-incomplete-export",
                                style: "padding:8px 12px;background:#fff7e6;color:#8a5a00;border:1px solid #e6a23c;border-radius:6px;cursor:pointer;",
                                onclick: () => finish("export-with-placeholders")
                            },
                            [t("download.action.exportPlaceholder")]
                        ),
                        el(
                            "button",
                            {
                                id: "esj-incomplete-retry",
                                style: "padding:8px 12px;background:#2b9bd7;color:#fff;border:1px solid #2b9bd7;border-radius:6px;cursor:pointer;font-weight:bold;",
                                onclick: () => finish("retry")
                            },
                            [t("download.action.retryMissing")]
                        )
                    ]
                )
            ]
        );
        const finish = (decision: IncompleteChapterDecision) => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", abortListener);
            popup.remove();
            resolve(decision);
        };
        signal?.addEventListener("abort", abortListener, { once: true });
        document.body.appendChild(popup);
        enableDrag(popup, ".esj-common-header");
        (popup.querySelector("#esj-incomplete-retry") as HTMLButtonElement | null)?.focus();
    });
}

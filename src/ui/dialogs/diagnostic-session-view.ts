import { createDiagnosticFilename } from "../../diagnostics/export";
import type { DiagnosticSessionPresentation, DiagnosticSessionView } from "../../diagnostics/manager";
import { el } from "../dom";
import { t } from "../locale";
import { formatDiagnosticSummary, formatDiagnosticBookTitle } from "../messages/diagnostics";

const resultPresentation: Record<
    DiagnosticSessionPresentation,
    { icon: string; key: Parameters<typeof t>[0]; color: string }
> = {
    running: { icon: "🔄", key: "diagnostics.result.running", color: "#2b9bd7" },
    success: { icon: "✅", key: "diagnostics.result.success", color: "#2e7d32" },
    cancelled: { icon: "🛑", key: "diagnostics.result.cancelled", color: "#777" },
    failed: { icon: "❌", key: "diagnostics.result.failed", color: "#c62828" },
    interrupted: { icon: "⚠️", key: "diagnostics.result.interrupted", color: "#a05a00" },
    "closed-unconfirmed": { icon: "⏳", key: "diagnostics.result.closed", color: "#a05a00" },
    superseded: { icon: "↪️", key: "diagnostics.result.superseded", color: "#56708a" }
};

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

function sessionResult(view: DiagnosticSessionView): { icon: string; label: string; color: string } {
    if (view.session.failures.some((failure) => failure.scope === "export") && view.presentation === "success") {
        return { icon: "⚠️", label: t("diagnostics.result.exportFailed"), color: "#a05a00" };
    }
    if (view.presentation === "running" && view.session.task.protectedPendingChapters > 0) {
        return { icon: "🔒", label: t("diagnostics.result.passwordPending"), color: "#a05a00" };
    }
    const presentation = resultPresentation[view.presentation];
    return { icon: presentation.icon, label: t(presentation.key), color: presentation.color };
}

function sessionPresentationHint(view: DiagnosticSessionView): string | null {
    if (view.presentation === "closed-unconfirmed") {
        return t("diagnostics.reason.closed");
    }
    if (view.presentation === "superseded") {
        return t("diagnostics.reason.superseded");
    }
    if (view.presentation === "interrupted" && view.session.result === "running") {
        return t("diagnostics.reason.interrupted");
    }
    return null;
}

/**
 * 创建会话选择行，由调用方持有选中状态并响应选择
 */
export function createDiagnosticSessionRow(
    view: DiagnosticSessionView,
    selected: boolean,
    onSelect: () => void
): HTMLElement {
    const session = view.session;
    const bookTitle = formatDiagnosticBookTitle(session);
    const presentation = sessionResult(view);
    const result = el("div", { style: `color:${presentation.color};font-weight:bold;` }, [
        `${presentation.icon} ${presentation.label}`
    ]);
    const title = el(
        "div",
        {
            title: bookTitle,
            style: "margin-top:3px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        },
        [bookTitle]
    );
    const updatedAt = el("div", { style: "margin-top:2px;color:#888;font-size:11px;" }, [
        formatTime(session.updatedAt)
    ]);

    return el(
        "button",
        {
            type: "button",
            style: `display:block;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #eee;background:${selected ? "#e8f5fc" : "transparent"};text-align:left;cursor:pointer;`,
            onclick: onSelect
        },
        [result, title, updatedAt]
    );
}

/**
 * 根据传入会话创建详情内容；空选择保留空状态，按钮可用性由父对话框管理
 */
export function createDiagnosticSessionDetail(view: DiagnosticSessionView | null): HTMLElement[] {
    if (!view) {
        return [el("div", { style: "padding:50px 12px;text-align:center;color:#777;" }, [t("diagnostics.empty")])];
    }
    const session = view.session;
    const bookTitle = formatDiagnosticBookTitle(session);
    const presentation = sessionResult(view);
    const presentationHint = sessionPresentationHint(view);

    // 详情先显示结果及解释，再展示脱敏摘要和导出文件名
    const title = el("div", { style: "font-size:18px;font-weight:bold;margin-bottom:6px;overflow-wrap:anywhere;" }, [
        bookTitle
    ]);
    const result = el("div", { style: `color:${presentation.color};font-weight:bold;margin-bottom:12px;` }, [
        `${presentation.icon} ${presentation.label}`
    ]);
    const content: HTMLElement[] = [title, result];
    if (presentationHint) {
        const hint = el(
            "div",
            {
                style: "padding:10px 12px;border:1px solid #9eb7ce;background:#f1f7fc;color:#375a7a;border-radius:6px;line-height:1.6;margin-bottom:12px;"
            },
            [presentationHint]
        );
        content.push(hint);
    }

    const privacyNotice = el(
        "div",
        {
            style: "padding:10px 12px;border:1px solid #e6a23c;background:#fff7e6;color:#8a5a00;border-radius:6px;line-height:1.6;margin-bottom:12px;"
        },
        [t("diagnostics.privacy")]
    );
    const summary = el(
        "pre",
        {
            style: "margin:0;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f7f7;border:1px solid #ddd;border-radius:6px;font:13px/1.65 monospace;"
        },
        [formatDiagnosticSummary(session, view.presentation)]
    );
    const filename = el("div", { style: "margin-top:10px;color:#777;font-size:12px;overflow-wrap:anywhere;" }, [
        t("diagnostics.file", { filename: createDiagnosticFilename(bookTitle, session.updatedAt) })
    ]);
    content.push(privacyNotice, summary, filename);
    return content;
}

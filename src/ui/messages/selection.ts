import { normalizeChapterSelectionSummary } from "../../download/plan";
import { t } from "../locale";

const SUMMARY_RANGE_LIMIT = 5;

/**
 * 已存在但非法的选择摘要仍归入自选，避免展示或筛选时冒充全本
 */
export function isPartialSelectionSummary(value: unknown): boolean {
    return value !== undefined && normalizeChapterSelectionSummary(value)?.mode !== "all";
}

/**
 * 统一呈现新旧选择摘要，原目录位置不依赖标题中的编号
 */
export function formatSelectionSummary(value: unknown, missingCount = 0): string {
    const summary = normalizeChapterSelectionSummary(value);
    let text: string;
    if (value === undefined || summary?.mode === "all") {
        text = t("range.modeAll");
    } else if (!summary) {
        text = t("selection.unknown");
    } else {
        const ranges = summary.ranges
            .slice(0, SUMMARY_RANGE_LIMIT)
            .map(({ startChapter, endChapter }) =>
                startChapter === endChapter ? String(startChapter) : `${startChapter}–${endChapter}`
            )
            .join("、");
        const omittedCount = summary.ranges.length - SUMMARY_RANGE_LIMIT;
        text = t("selection.summary", {
            ranges: ranges + (omittedCount > 0 ? t("selection.moreRanges", { count: omittedCount }) : ""),
            count: summary.selectedCount,
            total: summary.sourceTotalChapters
        });
    }
    return missingCount ? text + t("selection.missing", { count: missingCount }) : text;
}

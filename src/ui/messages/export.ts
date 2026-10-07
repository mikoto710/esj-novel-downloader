import { MappingFontError } from "../../content/mapping-font";
import { formatMappingFontError } from "./mapping-font";
import { t } from "../locale";

const MAX_EXPORT_ERROR_DETAIL_LENGTH = 2_000;

/**
 * 生成当前界面语言下有限长度的导出错误摘要
 */
export function getExportErrorDetails(error: unknown): string {
    const details =
        error instanceof MappingFontError
            ? formatMappingFontError(error.code)
            : error instanceof Error
              ? error.message
              : String(error);
    if (details.length <= MAX_EXPORT_ERROR_DETAIL_LENGTH) {
        return details;
    }
    return `${details.slice(0, MAX_EXPORT_ERROR_DETAIL_LENGTH)}\n${t("export.failure.truncated")}`;
}

import type { MappingFontErrorCode } from "../core/mapping-font";
import { t } from "./locale";

/**
 * 按当前界面语言格式化映射字型错误码
 */
export function formatMappingFontError(code: MappingFontErrorCode): string {
    const keys: Record<MappingFontErrorCode, Parameters<typeof t>[0]> = {
        "structure-invalid": "mapping.error.structureInvalid",
        "css-invalid": "mapping.error.cssInvalid",
        "font-source-invalid": "mapping.error.fontSourceInvalid",
        "font-too-large": "mapping.error.fontTooLarge",
        "woff2-invalid": "mapping.error.woff2Invalid",
        "hash-mismatch": "mapping.error.hashMismatch"
    };
    return t(keys[code]);
}

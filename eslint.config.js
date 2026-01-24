import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
    {
        ignores: ["dist/", "node_modules/"]
    },

    js.configs.recommended,

    ...tseslint.configs.recommended,

    prettierConfig,

    {
        files: ["src/**/*.ts"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.greasemonkey
            }
        },
        rules: {
            // 强制所有控制语句 (if, else, for, while) 必须使用大括号
            curly: ["error", "all"],

            // 允许使用 any
            "@typescript-eslint/no-explicit-any": "warn",

            // 允许非空断言 (DOM操作常用)
            "@typescript-eslint/no-non-null-assertion": "off",

            // 定义了但未使用的变量报警告，而不是报错
            "@typescript-eslint/no-unused-vars": "warn"
        }
    },

    // 补充 globals 库里可能没有的油猴变量
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            globals: {
                JSZip: "readonly",
                GM_xmlhttpRequest: "readonly",
                GM_setValue: "readonly",
                GM_getValue: "readonly",
                GM_registerMenuCommand: "readonly",
                unsafeWindow: "readonly"
            }
        }
    }
]
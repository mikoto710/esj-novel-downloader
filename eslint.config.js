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
        files: ["**/*.ts"],
        rules: {
            // 仅以下划线明确标记有意未使用的绑定，避免将遗漏误认为可接受的死代码。
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    caughtErrors: "all",
                    caughtErrorsIgnorePattern: "^_",
                    varsIgnorePattern: "^_"
                }
            ]
        }
    },

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

        }
    },

    {
        files: ["src/core/download/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "../mapping-font",
                            importNames: ["normalizeChapterMappingFont"],
                            message: "字体 DOM 解析通过 chapterProcessor.normalizeCached 注入"
                        }
                    ],
                    patterns: [
                        {
                            group: [
                                "**/ui/**",
                                "**/adapters/**",
                                "**/scrapers/**",
                                "**/state",
                                "**/config",
                                "**/book-lock",
                                "**/cache/book-cache",
                                "**/cache/indexeddb-repository",
                                "**/cache/legacy-cache",
                                "**/cache/sync",
                                "**/utils/dom",
                                "**/utils/request",
                                "**/utils/download",
                                "**/utils/log"
                            ],
                            message: "下载内核通过 contracts 接收能力，浏览器实现放在 adapters"
                        }
                    ]
                }
            ],
            "no-restricted-globals": [
                "error",
                {
                    globals: Array.from(
                        new Set([
                            ...Object.keys(globals.browser).filter((name) => !(name in globals.node)),
                            ...Object.keys(globals.greasemonkey),
                            "window",
                            "document",
                            "location",
                            "navigator",
                            "localStorage",
                            "sessionStorage",
                            "indexedDB",
                            "fetch",
                            "setTimeout",
                            "clearTimeout",
                            "setInterval",
                            "clearInterval"
                        ])
                    ),
                    checkGlobalObject: true
                }
            ]
        }
    }
];

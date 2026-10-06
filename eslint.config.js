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
        files: ["tests/ui/**/*.test.ts", "tests/download/browser-*.test.ts", "tests/export/export-recovery.contract.test.ts"],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: "CallExpression[callee.property.name=/^(toMatchSnapshot|toMatchInlineSnapshot|toMatchFileSnapshot|toHaveStyle|toHaveClass)$/]",
                    message: "UI 测试检查交互与结果，禁止固定界面快照、样式或 CSS 类"
                },
                {
                    selector: "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual|toMatch|toContain|toContainEqual)$/][arguments.0.type=Literal]:has(CallExpression[callee.name=expect]):has(MemberExpression[property.name=/^(style|className|classList)$/])",
                    message: "禁止用样式常量断言 UI；拖拽等交互应比较动作前后的变化"
                },
                {
                    selector: "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual|toMatch|toContain|toContainEqual)$/][arguments.0.type=Literal]:has(CallExpression[callee.name=expect]):has(CallExpression[callee.property.name=getAttribute][arguments.0.value=/^(style|class)$/])",
                    message: "禁止固定 UI 的 style 或 class 属性"
                }
            ]
        }
    },

    {
        files: ["src/locale/**/*.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    group: ["**/app/**", "**/ui/**", "**/site/**", "**/storage/**", "**/browser/**", "**/diagnostics/**"],
                    message: "语言目录只维护文案、插值和纯选择规则，站点状态由 site 读取，界面运行由 UI 维护"
                }]
            }],
            "no-restricted-globals": ["error", {
                globals: ["document", "location", "window", "navigator", "fetch", "indexedDB", "localStorage", "sessionStorage", ...Object.keys(globals.greasemonkey)],
                checkGlobalObject: true
            }]
        }
    },

    {
        files: ["src/site/locale.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    group: ["**/app/**", "**/ui/**", "**/storage/**", "**/browser/**", "**/diagnostics/**"],
                    message: "站点语言模块只读取传入文档的转换提示，偏好和界面运行由调用者维护"
                }]
            }],
            "no-restricted-globals": ["error", {
                globals: ["document", "location", "window", "navigator", ...Object.keys(globals.greasemonkey)],
                checkGlobalObject: true
            }]
        }
    },

    {
        files: ["src/storage/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/app/**", "**/ui/**", "**/diagnostics/runtime", "**/diagnostics/export"],
                            message: "存储只提供事实与受保护操作，页面会话和缓存管理由 app 协调"
                        }
                    ]
                }
            ]
        }
    },

    {
        files: ["src/diagnostics/manager.ts", "src/diagnostics/export.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    group: ["**/app/**", "**/ui/**", "**/site/**", "**/storage/**", "**/browser/**", "**/locale/**", "./runtime", "**/diagnostics/runtime"],
                    message: "诊断规则和 JSON 只处理传入数据，存储和任务环境由 runtime 装配，展示文本由 UI 提供"
                }]
            }],
            "no-restricted-globals": ["error", {
                globals: ["document", "location", "window", "navigator", "fetch", "indexedDB", "localStorage", "sessionStorage", ...Object.keys(globals.greasemonkey)],
                checkGlobalObject: true
            }]
        }
    },

    {
        files: ["src/ui/dialogs/format-choice.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [{
                    group: ["**/export/**", "**/storage/**", "**/browser/files", "**/diagnostics/**"],
                    message: "格式视图只通过 app/export 操作原结果，生成、历史和诊断规则由应用层维护"
                }]
            }]
        }
    },

    {
        files: ["src/export/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [{
                        group: ["**/app/**", "**/ui/**", "**/site/**", "**/storage/**", "**/locale/**"],
                        message: "导出只处理传入快照与资源，不读取页面会话、采集正文或认领缓存"
                    }]
                }
            ],
            "no-restricted-globals": ["error", {
                globals: ["document", "location", "window", "fetch", "indexedDB", "localStorage", "sessionStorage", ...Object.keys(globals.greasemonkey)],
                checkGlobalObject: true
            }]
        }
    },

    {
        files: ["src/download/**/*.ts", "src/export/snapshot.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        ...["../content/mapping-font", "../../content/mapping-font"].map((name) => ({
                            name,
                            importNames: ["normalizeChapterMappingFont"],
                            message: "字体 DOM 解析通过 chapterProcessor.normalizeCached / process 注入"
                        }))
                    ],
                    patterns: [
                        {
                            regex: "(?:^|/)storage/(?!(?:cache/(?:model|storage-error))(?:$|\\.(?:ts|js)$))",
                            message: "下载内核只引用中性的存储模型与错误契约，具体 I/O 由 app 任务装配注入"
                        },
                        {
                            group: [
                                "**/ui/**",
                                "**/locale/**",
                                "**/app/**",
                                "**/site/**",
                                "**/browser/**",
                                "**/diagnostics/**"
                            ],
                            message: "下载内核通过 contracts 接收能力，app 任务装配 browser 实现"
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

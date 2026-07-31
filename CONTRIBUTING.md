# 贡献指南

感谢你愿意为 ESJ Novel Downloader 提交改进。本指南主要用于规范外部贡献，帮助提交者和维护者更快确认改动范围、测试结果与潜在风险。

## 维护模式

本项目目前由单一维护者主导开发：

- 维护者可以在完成本地检查后直接提交到 `dev`。
- 外部贡献默认通过 Pull Request 合入 `dev`。
- `main` 只承载稳定版本；除发布合并或经维护者确认的紧急修复外，不直接向 `main` 提交 PR。
- CI 会检查对 `dev`、`main` 的直接推送以及指向这两个分支的 PR。

## 分支约定

| 分支 | 用途 |
| --- | --- |
| `main` | 当前稳定版本及正式发布标签 |
| `dev` | 日常开发、集成测试和预发布版本 |
| 功能分支 | 从 `dev` 创建，完成后通过 PR 合回 `dev` |
| 稳定版紧急修复分支 | 经维护者确认后从 `main` 创建，并在发布后同步回 `dev` |

建议使用能够表达意图的分支名，例如：

```text
feat/download-resume
fix/cache-lock-race
test/downloader-integration
docs/contribution-guide
```

## 开发环境

项目使用 Node.js 22。开始开发前请安装依赖并运行基线检查：

```bash
npm ci
npm run build
```

常用命令：

```bash
npm test
npm run test:watch
npm run check
npm run build
```

`npm run build` 会依次执行 TypeScript 检查、自动化测试和 userscript 构建，也是提交前的完整本地检查。

## 提交流程

1. 较大的功能、下载行为变更或缓存格式调整，建议先通过 Issue 讨论方案；范围明确的小型修复可以直接提交 PR。
2. 从最新的 `dev` 创建功能分支。
3. 保持改动聚焦，不要混入无关重构、大范围格式化或版本升级。
4. 根据改动补充测试和文档，并在本地运行 `npm run build`。
5. 向 `dev` 创建 PR，完整填写 PR 模板中的背景、测试方式和风险。
6. 根据审核意见修改；CI 通过且问题处理完毕后，由维护者决定合并方式。

## 测试要求

- 缺陷修复应增加能够在修复前失败、修复后通过的回归测试。
- 新增或修改下载行为时，应覆盖成功、失败、取消和必要的缓存恢复路径。
- 锁、缓存所有权和并发相关测试应使用可控时钟及隔离存储，避免依赖真实等待时间。
- 自动化测试不应依赖 ESJZone 实时站点；请使用最小化 HTML fixture、mock 或本地测试服务。
- 涉及浏览器下载、页面注入或 userscript API 时，请在 PR 中列出完成过的浏览器和脚本管理器手动验证。
- 如果某项测试不适用或暂时无法执行，请在 PR 中明确原因和剩余风险。

测试数据必须保持最小化，不要提交完整小说内容、登录信息、Cookie、访问令牌或其他敏感数据。

## 代码与提交规范

- 延续现有 TypeScript、ESLint 和 Prettier 配置，不在同一 PR 中进行无关格式化。
- 优先保持核心逻辑与 DOM、网络、存储之间的边界可测试。
- Commit 和 PR 标题采用 Conventional Commits 风格，例如：

```text
feat: add resumable chapter download
fix: prevent stale task cache writes
test: cover download lock cancellation
docs: clarify contribution workflow
chore: prepare 1.5.0-beta.1 release
```

常用类型包括 `feat`、`fix`、`test`、`refactor`、`docs`、`chore`、`ci` 和 `build`。

## PR 范围与审核

一个 PR 应当有一个清晰目标。维护者会重点检查：

- 改动是否解决了描述的问题；
- 是否破坏下载、取消、缓存恢复或导出流程；
- 并发与跨页面状态是否保持一致；
- 是否有足够的自动化测试和可复现的验证说明；
- 缓存结构或用户配置变化是否提供兼容、迁移或明确的失效策略；
- 文档是否与实际行为一致。

仅重构代码时，也需要说明如何确认行为没有变化。大规模重构应拆分为可独立审核的提交或 PR。

## 版本与发布

- 普通功能、修复和测试 PR 不修改 `package.json` 或 `package-lock.json` 中的项目版本。
- 不要自行创建或推送版本标签。
- 不要提交 `dist/`；发布工作流会从通过检查的源码构建 userscript。
- `alpha`、`beta`、`rc` 预发布版本从 `dev` 发布，正式版本从 `main` 发布。
- 版本号调整、发布标签和 GitHub Release 由维护者统一处理。

提交贡献即表示你同意贡献内容按本项目的 LICENSE 授权。

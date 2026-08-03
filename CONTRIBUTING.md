# 贡献指南

感谢你愿意为 ESJ Novel Downloader 提交改进。本指南用于说明开发边界、提交流程、验证要求和发布约定。

## 维护与分支

本项目目前由单一维护者主导开发：

- 外部贡献默认通过 Pull Request 合入 `dev`。
- `dev` 用于日常开发和预发布版本。
- `main` 只承载稳定版本。
- 紧急稳定版修复需要先由维护者确认，并在发布后同步回 `dev`。

功能分支应从最新的 `dev` 创建，并使用能够表达意图的名称，例如：

```text
feat/download-resume
fix/cache-lock-race
test/downloader-integration
docs/contribution-guide
```

## 开发环境

本地安装与构建方式见 [`README.md`](README.md#开发与构建)。

提交前至少运行：

```bash
npm run format:check
npm run build
```

涉及下载生命周期、缓存、迁移、锁、并发或取消时，还必须运行：

```bash
npm run test:stress
```

`npm run build` 包含 TypeScript 检查、普通自动化测试、ESLint、格式检查和 userscript 构建，但不包含压力测试。

## 架构边界

```text
scrapers / ui
    └─> core/download
            └─> contracts
                    └─> adapters / cache / browser APIs
```

- `scrapers/` 和 `ui/` 负责页面接入与用户交互。
- `core/download/` 负责状态流转、缓存恢复、调度、完整性检查、取消和导出准备。
- 核心逻辑不得直接访问 DOM、GM API 或浏览器全局状态。
- 浏览器能力通过 contracts 和 adapter 注入。
- `core/cache/` 负责增量缓存、迁移、所有权和跨页面同步。
- 成功、失败和取消必须经过统一收尾流程。
- 缺章占位只用于本次导出，不得写回章节 Map 或持久缓存。
- 缓存 schema、取消语义或其他重大用户行为变化应先讨论兼容和迁移方案。

## 提交流程

1. 从最新的 `dev` 创建功能分支。
2. 保持改动聚焦，不混入无关重构、格式化或版本升级。
3. 缺陷修复应增加回归测试；新增行为应覆盖对应业务边界。
4. 更新受影响的用户文档或开发文档。
5. 执行适用的自动化测试和浏览器验证。
6. 向 `dev` 创建 Pull Request，并填写背景、测试结果和剩余风险。

较大的下载行为、缓存格式或跨页面流程调整，建议先通过 Issue 讨论方案。

## 测试要求

测试应放在实际业务边界：

- 下载协调和生命周期：`tests/download/`
- 缓存、迁移、锁和跨页面同步：`tests/cache/`
- 映射字体：`tests/mapping-font/`
- TXT、HTML、EPUB 和图片：`tests/export/`
- 页面与弹窗行为：`tests/ui/`
- 测试基础设施和诊断持久化：`tests/infrastructure/`
- 大章节量和慢存储场景：`tests/stress/`

详细测试约定见 [`tests/README.md`](tests/README.md)。

涉及浏览器下载、页面注入或 userscript API 时，应在 PR 中说明：

- 使用的浏览器和版本；
- 使用的 userscript 管理器和版本；
- 手动验证的页面入口和导出格式；
- 尚未验证的环境及剩余风险。

## 代码与注释

- 延续现有 TypeScript、ESLint 和 Prettier 配置。
- 不在同一 PR 中执行无关的大范围格式化。
- 生产代码注释使用中文。
- 注释用于解释业务不变量、生命周期所有权、兼容边界或竞态顺序，不逐句复述语法。
- 测试文件和 `describe` / `it` 描述统一使用英文。
- 核心逻辑应保持环境无关，并通过 contracts 和 adapter 注入浏览器能力。

## 测试数据与诊断信息

自动化测试应使用合成或最小化 fixture，不得依赖实时 ESJZone 页面或真实网络。

不要提交：

- 完整小说正文或章节 HTML；
- Cookie、认证信息、访问令牌或请求头；
- 图片、字体、Blob、data URI 或 Base64；
- 原始 IndexedDB 记录；
- 未清理的完整调用栈。

可以附上脚本导出的诊断 JSON，但应先确认其中的作品名称、作品链接和失败章节信息可以公开。

## Commit 与 PR 标题

采用 Conventional Commits 风格，例如：

```text
feat: add resumable chapter download
fix: prevent stale task cache writes
test: cover download lock cancellation
docs: clarify contribution workflow
chore: prepare beta release
```

常用类型包括 `feat`、`fix`、`test`、`refactor`、`docs`、`chore`、`ci` 和 `build`。

## 版本与发布

- 普通功能、修复和测试 PR 不修改项目版本。
- 不要自行创建或推送版本标签。
- 不要提交 `dist/`。
- `alpha`、`beta` 和 `rc` 从 `dev` 发布。
- 稳定版本从 `main` 发布。
- 版本号、标签和 GitHub Release 由维护者统一处理。

发布准备需要记录：

- `npm run format:check`
- `npm run build`
- 必要的 `npm run test:stress`
- 浏览器与 userscript 管理器验收
- 已接受的非阻塞限制

现有标签、CI 结果或旧的 `dist/` 文件不能单独作为发布证据。

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
npm run build
```

涉及下载生命周期、缓存、迁移、锁、并发或取消时，还必须运行：

```bash
npm run test:stress
```

`npm run build` 包含 TypeScript 检查、普通自动化测试、ESLint、格式检查和 userscript 构建，但不包含压力测试。

`npm run build:fast` 只适合本地迭代，不运行自动化测试、ESLint 或格式检查，不能代替提交、CI 或发布前的完整构建。

## 架构边界

修改下载入口、缓存、取消、密码或导出流程前，先读 [`docs/architecture.md`](docs/architecture.md)。其中记录实际调用链、状态所有者和代表测试；从 `download/run.ts` 阅读业务阶段，再进入相应模块。

- 共享章节、资源和书籍数据归 `content/model.ts`，字体与图片契约归 `content/`；`browser/` 提供具体请求、等待、文件与脚本加载能力，由 `app/book-download.ts` 装配。下载内核通过明确输入、能力和返回结果协作，ESLint 检查直接依赖边界。
- `storage/` 提供持久化事实和受保护操作，`app/cache-management.ts` 合并缓存列表并协调用户清理；`app/book-download.ts` 负责浏览器任务收尾。
- 业务层通过 `messages.ts` 输出稳定消息代码，由 `ui/messages/` 本地化；小说正文、书籍元数据、原始链接及站点协议文本保持原样。
- 全本与范围共享书籍锁和缓存；成功、失败、取消都经过统一收尾。缓存格式或取消语义变化先说明兼容方案。
- 每次下载显式传入章节表、锁与取消能力；`app/page-session.ts` 的页面 state 只持有操作入口、显示摘要和最近导出。旧任务回调必须校验 taskId。
- 本次范围就绪数 `readyChapterCount` 与整书库存 `bookChapterCount` 分开；清理摘要、续传缓存和导出结果分别操作。

类型就近定义在维护规则的模块；共享内容在 `content/model.ts`，取消协议在 `download/contracts.ts`，快照摘要与格式分别在 `export/snapshot.ts`、`export/filename.ts`，缓存公开模型与内部 schema 分开。视图节点、拖动与清理改 `ui/dom.ts`，日志呈现改 `ui/log-view.ts`，记录规则改 `diagnostics/manager.ts`，中性消息数据约定改 `messages.ts`。

## 提交流程

1. 从最新的 `dev` 创建功能分支。
2. 按架构入口追踪调用者、规则所有者与退出路径，连同真实 source / test import 更新；依赖检查区分运行时与仅类型引用。保持改动聚焦，不混入无关重构、格式化或版本升级。
3. 复用已有边界测试；只有合成环境能可靠重现且现有测试未覆盖的业务边界才增加用例。普通页面改动在任务或 Pull Request 中记录真实页面复现与验收，仓库指南不保存验收记录。
4. 更新受影响的用户文档或开发文档及 `.codex/skills` 维护入口；用户可见行为变化应同步核对 `README.md` 和 `README.zh-TW.md`。
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

本项目是油猴脚本，普通页面注入、控件操作、文案、语言刷新、拖拽和滚动以真实页面验收为主。自动化集中保护范围索引、缓存和锁所有权、取消、协议异常、损坏输入、导出数据与资源上限；UI / adapter 仅保留异步决策和状态丢失等关键边界。

先复用已有证据，避免为每个入口、普通成功路径、薄包装或覆盖率复制用例。纯逻辑默认使用 Node；确实依赖 DOM、DOMParser、导出文档结构或 UI 边界时才使用 jsdom。fixture 和 GM mocks 的通过结果不等于真实 userscript 验收。

详细测试约定见 [`docs/testing.md`](docs/testing.md)。

涉及浏览器下载、页面注入或 userscript API 时，应在 PR 中说明：

- 使用的浏览器和版本；
- 使用的 userscript 管理器和版本；
- 手动验证的页面入口和导出格式；
- 尚未验证的环境及剩余风险。

## 代码与注释

- 延续现有 TypeScript、ESLint 和 Prettier 配置。
- 不在同一 PR 中执行无关的大范围格式化。
- 生产代码注释使用中文。
- 方法注释用三行式 JSDoc，中间一句精炼中文说明职责；只在关键阶段用简短 `//` 解释顺序、所有权或兼容限制，不逐句复述代码。
- 较长的 UI 元素组装按布局区域或交互职责补短注释，标出条件显示和操作范围。
- 分组注释前保留一行空白，注释紧贴对应代码；函数、代码块或数组开头不额外留空行。
- 公开入口按调用方需要说明输入、结果或退出约定，不写长篇使用说明；JSDoc 不以句号结尾。
- 实现注释使用 `//`，需要连续说明时每行均使用 `//`；`/** ... */` 仅用于 JSDoc，不与普通块注释混用。
- `zh-TW` 文案使用台湾常用软件用语人工本地化，不采用机械式简转繁。
- 测试文件和 `describe` / `it` 描述统一使用英文。
- 下载规则保持环境无关，由 `app/book-download.ts` 通过 `download/contracts.ts` 注入 `site/`、`browser/`、`storage/` 与视图能力。

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

沿用项目历史的 Conventional Commits `type: subject` 格式，不加 scope，例如：

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
- 标签必须与 `package.json` 中的版本完全一致；预发布标签提交必须包含在 `dev`，稳定版标签提交必须包含在 `main`。
- 发布资源必须由对应标签的源码重新构建，不得复用旧的 `dist` 产物。
- 版本号、标签和 GitHub Release 由维护者统一处理。
- 浏览器验收应记录实际验证范围；当前主动发布验收以 Chrome + Tampermonkey 为准，未验证 Firefox + Violentmonkey 时不得宣称已经覆盖该组合。

修改 `.codex/skills` 后应运行 skill 结构校验，并确认 `agents/openai.yaml` 仍与对应的 `SKILL.md` 一致。

发布准备需要记录：

- `npm run build`
- `npm run test:stress`（发布候选必需）
- 浏览器与 userscript 管理器验收
- 已接受的非阻塞限制

现有标签、CI 结果或旧的 `dist/` 文件不能单独作为发布证据。

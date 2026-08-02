# ESJ Novel Downloader

![Version](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=version) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

一个用于 **ESJZone** 的 Tampermonkey 脚本。  
支持 **TXT / EPUB / HTML 下载**，并适配多种页面类型 (小说详情页 / 单章阅读页 / 论坛列表页)。

## 功能特性

- 📚 **多格式导出**: 全本支持 TXT、EPUB 和 HTML，单章支持 TXT 和 HTML。
- ⚡ **并发抓取与断点续传**: 支持配置并发数，并通过 IndexedDB 保存全本下载进度。
- 🛡️ **完整性检查与重试**: 下载后检查缺失章节和异常图片，并自动重试可恢复的问题。
- 🖼️ **导出内容增强**: 全本 EPUB / HTML 支持封面与正文插图，EPUB 支持书籍元数据和标签。
- 🧾 **下载管理**: 提供缓存管理和全本、单章下载记录。

> 💡 抓取逻辑部分参考自 [ESJ-novel-backup](https://github.com/ZALin/ESJ-novel-backup)，感谢原项目作者提供的抓取思路

## 页面支持

| 页面类型       | 支持功能                    | 对应模块             | 链接格式示例             |
| :------------- | :-------------------------- | :------------------- | :----------------------- |
| **小说详情页** | 🟢 全本下载 (TXT/EPUB/HTML) | `scrapers/detail.ts` | `.../detail/123.html`    |
| **论坛列表页** | 🟢 全本下载 (TXT/EPUB/HTML) | `scrapers/forum.ts`  | `.../forum/123/456/`     |
| **单章阅读页** | 🔵 单章导出 (TXT/HTML)      | `scrapers/single.ts` | `.../forum/123/456.html` |

## 安装方式

### 1. 安装脚本管理器

- [Tampermonkey](https://www.tampermonkey.net/) (推荐)
- Violentmonkey

### 2. 安装脚本

[👉 **点击这里直接安装最新版**](https://github.com/mikoto710/esj-novel-downloader/releases/latest/download/esj-novel-downloader.user.js)

或前往 [GreasyFork 发布页](https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD) / 本 GitHub 仓库的 [Releases 页面](https://github.com/mikoto710/esj-novel-downloader/releases) 手动下载。

## 使用方法

脚本会自动检测当前页面类型并提供相应的下载入口。

### 全本下载

1. 在小说详情页或论坛列表页点击“全本下载”。
2. 如果检测到未完成的本地缓存，确认窗口会显示已缓存章节数；继续下载时会跳过已有章节。
3. 下载过程中可以最小化进度窗口。点击“取消任务”会停止抓取并尝试保存当前进度。
4. 主抓取完成后，脚本会检查缺失章节；开启正文插图时，也会检查失败图片并尝试自动补抓。
5. 处理完成后选择 TXT、EPUB 或 HTML 导出；开启正文插图时，窗口会显示图片处理结果。

### 单章导出

在单章阅读页顶部会显示 TXT 和 HTML 两个下载按钮：

- **TXT**: 导出当前章节的纯文本内容。
- **HTML**: 导出带排版的单页文件；开启正文插图后，会尝试将图片写入文件。

### 设置

小说详情页和论坛列表页的“全本下载”按钮旁提供“设置”入口：

- **下载线程数**: 设置并发章节请求数量，默认为 5。更高的并发数不一定更快，可能受到网络或站点限制。
- **下载正文插图**: 抓取章节正文中的图片并写入 EPUB / HTML。开启后会增加下载时间、缓存占用和导出体积。
- **生成 EPUB 标签页**: 在 EPUB 中生成独立标签页；关闭后标签仍会写入 EPUB 元数据。
- **缓存管理**: 查看和清理持久缓存、当前页会话缓存，以及停止正在运行的下载任务。
- **下载记录**: 查看、筛选和清理全本及单章导出记录。

> **正文插图说明**: 插图开关不影响封面。开启后，脚本会在章节抓取阶段下载并处理正文图片；成功的图片会写入 EPUB / HTML，失败的图片会保留原始链接并计入结果统计。TXT 不包含图片；当前版本开启该选项后，TXT 下载也可能执行图片处理，因此仅需要 TXT 时建议关闭。部分图片需要脚本管理器授予跨域访问权限。
>
> 切换插图设置时，脚本会请求清理已有缓存，避免混用不同设置下的章节数据。正在下载的任务及其缓存不会被清理，任务会继续使用启动时的设置。

### 自定义映射字体正文

部分 ESJZone 作品会用章节专属字体替换正文字符。页面视觉上仍是正常汉字，但底层 Unicode 并不是真实正文，因此这不是 UTF-8 文件编码问题。

- 脚本会按严格结构识别此类章节；首次检测到后暂停领取新章节并要求确认，普通章节不受影响。
- 映射正文无法生成正确 TXT，因此全本和单章的 TXT 按钮会禁用。
- HTML / EPUB 会嵌入每章经过校验的原始 WOFF2，但能否正确显示取决于浏览器或阅读器是否支持并启用内嵌字体；复制、搜索、词典、朗读和无障碍阅读仍可能得到错误字符。
- EPUB 阅读器兼容性并不一致：目前实测 Thorium Reader 可以正常渲染映射字体，Chrome 扩展 Beautiful EPUB Reader 仍会显示未映射的底层字符。遇到显示异常时，请先改用支持内嵌字体的阅读器。
- 每章可能使用独立字体，缓存和导出文件会明显增大。已验证样本中，231 个字体章节约为 EPUB 增加 76.7 MiB，单文件 HTML 使用 base64 后约增加 102.3 MiB。
- 字体缺失、结构不匹配或完整性校验失败时会阻止静默导出，并显示失败章节。

恢复真实 Unicode 仍是长期方向；当前字体嵌入方案只是明确标注的临时视觉兼容措施。

## 开发与构建

本项目基于 **TypeScript** 开发，使用 **Rollup** + **esbuild** 构建 userscript，并使用 **Vitest** + **jsdom** 运行自动化测试。全本下载已按页面接入、浏览器适配、核心流程和持久化边界拆分，修改时应保持各层职责独立。

### 下载架构

```text
scrapers / ui
    └─> core/download/batch-download.ts
            ├─> core/download/coordinator.ts
            └─> adapters/browser-download-dependencies.ts
                    ├─> core/cache
                    ├─> core/book-lock.ts / core/state.ts
                    └─> ui / GM API / DOM
```

- `batch-download.ts` 是页面层启动全本下载的组合入口，只负责创建浏览器依赖并调用核心流程。
- `coordinator.ts` 负责下载状态流转、缓存恢复、章节调度、完整性检查、取消和导出准备，不直接访问 DOM、GM API 或浏览器全局状态。
- `contracts.ts` 定义下载核心所需的端口和数据结构；浏览器实现集中在 `adapters/browser-download-dependencies.ts`。
- `core/cache/` 负责 v3 增量缓存、旧缓存惰性迁移、缓存列表与跨页面同步。
- 下载任务的锁、缓存写入者和取消模式必须保持一致；成功、失败和取消路径都应进入统一收尾流程。
- 新增下载流程行为时，优先通过依赖端口扩展核心，不要把页面对象重新引入 `core/download/`。

### 项目结构

```
src
├── adapters
│   └── browser-download-dependencies.ts  # 下载端口的浏览器实现与装配
├── core
│   ├── cache
│   │   ├── book-cache.ts                 # 书籍缓存聚合与惰性迁移
│   │   ├── indexeddb-repository.ts       # v3 IndexedDB 持久化
│   │   ├── legacy-cache.ts               # v2 及更早缓存读取
│   │   ├── manager.ts                    # 缓存查看、停止与清理
│   │   └── sync.ts                       # 缓存跨页面同步
│   ├── download
│   │   ├── batch-download.ts             # 全本下载的浏览器组合入口
│   │   ├── coordinator.ts                # 可注入依赖的下载主流程
│   │   ├── contracts.ts                  # 核心端口与流程类型
│   │   ├── cache-write-buffer.ts         # 增量缓存批量写入
│   │   ├── integrity.ts                  # 章节与图片完整性检查
│   │   ├── retry-policy.ts               # 可取消的重试策略
│   │   ├── state-machine.ts              # 下载阶段状态机
│   │   ├── task-finalizer.ts             # 锁与缓存统一收尾
│   │   └── worker-pool.ts                # 有界并发任务调度
│   ├── book-lock.ts                      # 跨页面任务锁与取消协调
│   ├── config.ts                         # 用户配置管理
│   ├── download-history.ts               # 下载记录存储
│   ├── epub.ts / html.ts                 # 导出文件生成
│   ├── mapping-font.ts                   # 映射字体检测、校验与导出绑定
│   ├── parser.ts                         # 章节 HTML 解析
│   └── state.ts                          # 浏览器运行时状态
├── scrapers                              # 不同 ESJZone 页面接入
├── ui                                    # 页面组件、弹窗与样式
├── utils                                 # DOM、图片与文本工具
├── global.d.ts                           # userscript 全局类型
├── index.ts                              # 项目入口
└── types.ts                              # 公共业务类型

tests
├── download / cache                      # 下载流程与缓存边界
├── mapping-font / export / ui            # 字体、导出与界面行为
├── infrastructure                        # 测试设施自测
├── support                               # mocks、fixtures、fakes 与资源追踪
├── stress                                # 大章节量专项压力测试
└── setup.ts                              # 测试环境与泄漏检查
```

### 本地构建

需要 **Node.js 20.19+** 环境；推荐使用 **Node.js 22**，与 CI 和发布工作流保持一致。

```bash
# 1. 安装依赖 (推荐使用 npm ci)
# npm install
npm ci

# 2. 开发模式 (监听文件变更自动构建)
npm run watch

# 3. 格式化 src 并运行可自动修复的 ESLint 规则
npm run format

# 4. 类型检查、自动化测试并生成最终 userscript
npm run build
```

`npm run format` 会直接修改文件，执行后应检查差异。构建产物位于 `dist/esj-novel-downloader.user.js`。

### 自动化测试

普通测试覆盖纯函数、下载核心、缓存、锁、取消、UI 契约和导出隔离；需要浏览器 DOM 的测试使用 jsdom。测试不得依赖实时 ESJZone 页面或真实网络，详细约定见 [`tests/README.md`](tests/README.md)。

```bash
# 单次运行全部测试
npm test

# 监听文件变化并持续运行测试
npm run test:watch

# 执行 TypeScript 类型检查和全部测试
npm run check

# 执行 3000 章缓存复杂度与下载流程压力测试
npm run test:stress
```

普通 `npm test` 和 `npm run check` 不包含 `tests/stress/`。修改下载调度、增量缓存、锁或取消机制时，应额外运行 `npm run test:stress`。

### 提交与发布前检查

```bash
# 1. 检查格式；若失败，按提示格式化并审查修改
npm run format:check

# 2. 类型检查、普通测试和正式构建
npm run build

# 3. 大章节量压力测试
npm run test:stress
```

发布提交仅更新版本与发布相关文档。发布标签必须与 `package.json` 完全一致，例如版本 `1.5.0-beta.1` 对应标签 `v1.5.0-beta.1`。

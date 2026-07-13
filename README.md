# ESJ Novel Downloader

![Version](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=version) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

一个用于 **ESJZone** 的 Tampermonkey 脚本。  
支持 **TXT / EPUB / HTML 下载**，并适配多种页面类型 (小说详情页 / 单章阅读页 / 论坛列表页)。

## 功能特性

- 📚 **多格式导出**: 支持 **TXT**、**EPUB** 和 **HTML**，支持自动内嵌封面。
- ⚡ **极速下载**: 多线程并发抓取，支持用户配置。
- 💾 **断点续传**: 使用 IndexedDB 作为缓存，刷新页面或关闭浏览器不丢失进度，并支持在缓存管理中查看和清理缓存。
- 🛡️ **智能补漏**: 自动检测抓取失败的章节并尝试重试，确保内容完整。
- 🧩 **多页面适配**: 支持详情页、论坛版块、单章阅读页多种场景。
- 🖼️ **正文插图下载**: 支持导出 EPUB / HTML 时附带插图。
- 🏷️ **书籍元数据与标签**: TXT 元数据块保留简介与标签；EPUB 写入简介和标准 `dc:subject` 标签，便于书库分类与检索。

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

脚本会自动检测当前页面类型并注入按钮:

1.  **小说详情页 / 论坛版块页**:
    - 点击注入的 **“全本下载”** 按钮。
    - 确认下载后，会出现进度弹窗 (支持最小化)。
    - 完成后选择导出格式即可，若开启插图下载，会显示图片的拉取情况。

2.  **单章阅读页**:
    - 在顶部导航栏中间 "≡" 旁会出现两个下载按钮 (从左到右，`icon-download` -> TXT， `icon-code` -> HTML)。
    - 点击直接下载当前章节的 TXT / HTML 文件。

在**小说详情页 / 论坛版块页**的 **"全本下载"** 按钮旁边，提供了 **"设置" (⚙️)** 按钮，点击可进行配置:

- **下载线程数**: 调整并发请求数量 (默认为 5，建议 1-5)，平衡速度与稳定性。
- **下载正文插图**: 默认关闭。开启后可在生成的 EPUB / HTML 小说文件中加入对应的插图，若抓取失败会插入对应的 img 标签。
- **生成 EPUB 标签页**: 默认关闭。开启后会在 EPUB 目录和首章之前生成“标签”页；无论是否开启，标签都会写入 EPUB 元数据，供书库分类与检索。
- **缓存管理**: 查看当前缓存列表，支持清理 IndexedDB 持久缓存或当前页会话缓存，也可执行单个/全部清理。

> **Note**: 开启下载正文插图功能后脚本管理器会请求跨域访问权限，请允许，否则无法正常拉取某些图床图片。若当前存在缓存，切换该选项时会先弹出确认提示，并在确认后清理相关缓存。

## 开发与构建

本项目基于 **TypeScript** 开发，使用 **Rollup** + **esbuild** 进行构建。

### 项目结构

```
src
├── core                 # 核心业务逻辑层
│   ├── config.ts        # 用户配置管理
│   ├── downloader.ts    # 通用下载控制器
│   ├── epub.ts          # EPUB 生成器
│   ├── html.ts          # 单页 HTML 生成器
│   ├── cache-manager.ts # 缓存聚合与清理逻辑
│   ├── parser.ts        # HTML 解析器
│   ├── state.ts         # 全局状态管理
│   └── storage.ts       # 持久化存储层
├── scrapers             # 页面抓取策略层
│   ├── detail.ts        # 针对 [小说详情页] 的抓取逻辑
│   ├── forum.ts         # 针对 [论坛列表页] 的抓取逻辑
│   └── single.ts        # 针对 [单章正文页] 的抓取逻辑
├── ui                   # 界面交互层
│   ├── components.ts    # 通用 UI 组件
│   ├── detail.ts        # 目录页 UI 注入
│   ├── forum.ts         # 论坛页 UI 注入
│   ├── single.ts        # 单章页 UI 注入
│   ├── cache-manager.ts # 缓存管理弹窗
│   ├── popups.ts        # 弹窗组件库
│   ├── styles.ts        # CSS 样式定义
│   └── tray.ts          # 最小化悬浮球组件
├── utils                # 通用工具库
│   ├── dom.ts           # DOM 操作工具
│   ├── image.ts         # 图片处理工具
│   ├── index.ts         # 基础工具
│   └── text.ts          # 文本处理工具
├── global.d.ts          # 全局类型声明
├── index.ts             # 项目总入口
└── types.ts             # TypeScript 类型定义接口
```

### 本地构建

需要 **Node.js 18+** 环境，与 GitHub Actions 最低版本保持一致，推荐使用 **Node.js 22.22.0 LTS**

```bash
# 1. 安装依赖 (推荐使用 npm ci)
# npm install
npm ci

# 2. 开发模式 (监听文件变更自动构建)
npm run watch

# 3. 代码格式化 (非必须，建议提交前执行)
npm run format

# 3. 生产构建 (生成最终 user.js)
npm run build
```

构建产物位于: `dist/esj-novel-downloader.user.js`

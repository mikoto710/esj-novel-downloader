# ESJ Novel Downloader

![Stable](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=stable) ![Pre-release](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?include_prereleases&label=pre-release) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

一个用于 **ESJZone** 的 Tampermonkey 脚本。  
支持 **TXT / EPUB / HTML 下载**，并适配多种页面类型 (小说详情页 / 单章阅读页 / 论坛列表页)。

## 功能特性

- 📚 **多格式导出**: 全本支持 TXT、EPUB 和 HTML，单章支持 TXT 和 HTML。
- ⚡ **并发抓取与断点续传**: 支持配置并发数，并通过 IndexedDB 保存全本下载进度。
- 🛡️ **完整性检查与重试**: 下载后检查缺失章节和异常图片，并自动尝试补抓异常内容。
- 🔒 **密码章节处理**: 适配网站加密章节，支持在全本下载过程中识别和解锁。
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

脚本会自动检测当前页面类型，并提供相应的下载入口。

### 全本下载

1. 在小说详情页或论坛列表页点击“全本下载”。
2. 如果存在未完成的本地缓存，可以继续下载并跳过已经完成的章节。
3. 遇到密码保护章节时，会弹出密码输入窗口，可以提交密码解锁、跳过本章、跳过全部剩余密码章节或取消本次下载。
4. 下载期间可以最小化进度窗口；点击“取消任务”会停止抓取并尝试保存当前进度。
5. 下载完成后会自动检查缺失章节；开启正文插图时，也会检查失败图片并尝试补抓。
6. 如果补抓后仍有章节缺失，可以选择：
    - 只重试缺失章节；
    - 使用明确占位继续导出；
    - 取消并保留缓存。
7. 处理完成后，可以选择 TXT、EPUB 或 HTML 导出。

> 缺章占位只会写入本次导出，不会保存到章节缓存。

### 单章导出

单章阅读页顶部提供以下按钮：

- **TXT**：导出当前章节的纯文本内容。
- **HTML**：导出保留排版的单页文件；开启正文插图后会尝试嵌入图片。

> 如果当前章节受密码保护，需要先在正文区域输入密码并完成解锁。

### 设置

小说详情页和论坛列表页的“全本下载”按钮旁提供“设置”入口：

- **下载线程数**：设置并发章节请求数量，默认为 5。
- **界面语言**：可选择“自动（跟随网站）”“简体中文”或“繁體中文”；手动选择会保存并优先于自动判断。
- **下载正文插图**：抓取正文图片并写入 EPUB / HTML；会增加下载时间、缓存占用和文件体积。
- **生成 EPUB 标签页**：控制是否在 EPUB 中生成独立标签页。
- **缓存管理**：查看或清理下载缓存，以及停止正在运行的任务。
- **下载记录**：查看和清理全本及单章导出记录。
- **诊断日志**：查看当前任务和最近 7 天内最多 30 次任务的诊断记录；单次上限 256 KiB，总计上限 4 MiB。

界面语言只影响脚本自身的按钮、弹窗、状态、日志和错误提示，不会转换小说正文、书籍元数据，也不会改变 TXT、EPUB 或 HTML 中的小说内容。

正文插图开关不影响封面。图片抓取失败时，脚本会尽量保留原始链接并在结果中提示。部分图片可能需要脚本管理器授予跨域访问权限。

全本任务启动时会固定本次插图设置；任务运行期间在其他页面修改该设置，只影响之后新启动的任务。

### 诊断与问题反馈

下载、缓存或导出发生错误时，可以从错误弹窗或设置中的“诊断日志”打开诊断记录，并下载 JSON 或复制摘要。

诊断文件会包含运行环境、作品名称与链接、任务设置、导出结果和失败章节等信息，需要反馈下载相关问题时，建议一并提供对应任务的诊断 JSON，以便维护者定位问题。

## 已知问题

- 少数作品使用自定义映射字体，页面可正常显示，但底层文本不一定是真实 Unicode。此类内容不能导出 TXT；HTML / EPUB 的显示取决于阅读器对内嵌字体的支持，复制、搜索和朗读也可能出现错误字符，同时会导致文件体积显著增加。
- 断点进度保存在浏览器 IndexedDB 中。清理站点数据、使用隐私模式或更换浏览器配置文件可能丢失缓存；发生存储失败事件时，最新一批进度可能不会保存。

## 开发与构建

需要 **Node.js 20.19+** 环境；推荐使用 **Node.js 22**，与 CI 和发布工作流保持一致。

```bash
# 1. 安装依赖 (推荐使用 npm ci)
# npm install
npm ci

# 2. 开发模式 (监听文件变更自动构建)
npm run watch

# 3. 使用 Prettier 格式化源码、测试和受管理文档
npm run format

# 4. 类型检查、自动化测试并生成最终 userscript
npm run build
```

`npm run format` 会直接修改文件，执行后应检查差异。构建产物位于 `dist/esj-novel-downloader.user.js`。

贡献流程、代码规范和发布要求见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，测试目录与隔离约定见 [`tests/README.md`](tests/README.md)。

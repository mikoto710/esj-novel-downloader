# ESJ Novel Downloader

![Stable](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=stable) ![Pre-release](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?include_prereleases&label=pre-release) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

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

脚本会自动检测当前页面类型，并提供相应的下载入口。

### 全本下载

1. 在小说详情页或论坛列表页点击“全本下载”。
2. 如果存在未完成的本地缓存，可以继续下载并跳过已经完成的章节。
3. 下载期间可以最小化进度窗口；点击“取消任务”会停止抓取并尝试保存当前进度。
4. 下载完成后会自动检查缺失章节；开启正文插图时，也会检查失败图片并尝试补抓。
5. 如果补抓后仍有章节缺失，可以选择：
    - 只重试缺失章节；
    - 使用明确占位继续导出；
    - 取消并保留缓存。
6. 处理完成后，可以选择 TXT、EPUB 或 HTML 导出。

缺章占位只会写入本次导出，不会保存到章节缓存。

### 单章导出

单章阅读页顶部提供以下按钮：

- **TXT**：导出当前章节的纯文本内容。
- **HTML**：导出保留排版的单页文件；开启正文插图后会尝试嵌入图片。

### 设置

小说详情页和论坛列表页的“全本下载”按钮旁提供“设置”入口：

- **下载线程数**：设置并发章节请求数量，默认为 5。
- **下载正文插图**：抓取正文图片并写入 EPUB / HTML；会增加下载时间、缓存占用和文件体积。
- **生成 EPUB 标签页**：控制是否在 EPUB 中生成独立标签页。
- **缓存管理**：查看或清理下载缓存，以及停止正在运行的任务。
- **下载记录**：查看和清理全本及单章导出记录。
- **诊断日志**：查看当前任务和最近 10 次任务的诊断记录。

正文插图开关不影响封面。图片抓取失败时，脚本会尽量保留原始链接并在结果中提示。部分图片可能需要脚本管理器授予跨域访问权限。

### 诊断与问题反馈

下载、缓存或导出发生错误时，可以从错误弹窗或“设置 → 诊断与反馈”打开诊断记录，并下载 JSON 或复制摘要。

诊断文件会包含运行环境、作品名称与链接、任务设置、导出结果和失败章节信息，但不会包含小说正文、登录凭据、图片或字体内容。由于文件仍包含阅读作品和章节信息，请确认后再公开上传。

下载进度窗口只保留最近 1000 个日志事件。需要反馈问题时，建议提供对应任务的诊断 JSON，并说明复现步骤、导出格式和正文插图设置。

### 自定义映射字体正文

部分 ESJZone 作品使用章节专属字体显示正文。页面视觉上是正常汉字，但底层 Unicode 并不是真实正文，因此这不是 UTF-8 编码问题。

- 脚本检测到此类章节后会暂停领取新章节，并要求用户确认是否继续。
- 映射正文无法生成正确 TXT，因此 TXT 导出会被禁用。
- HTML / EPUB 会嵌入章节字体，但复制、搜索、词典和朗读仍可能得到错误字符。
- 是否能够正确显示取决于浏览器或阅读器对内嵌字体的支持。
- 目前实测 Thorium Reader 可以正常渲染；Chrome 扩展 Beautiful EPUB Reader 无法正确显示。
- 每章可能使用独立字体，因此缓存和导出文件体积可能明显增加。
- 字体缺失或结构校验失败时，脚本会停止导出并显示失败章节。

恢复真实 Unicode 是长期方向；当前方案仅提供视觉兼容。

### 兼容性与已知限制

- 当前主动验收环境为 **Chrome + Tampermonkey**。其他浏览器或脚本管理器尚未纳入发布门槛。
- 断点进度保存在浏览器 IndexedDB 中。清理站点数据、使用隐私模式或更换浏览器配置文件可能导致缓存丢失。
- 如果发生存储失败，脚本会明确提示；最新一批下载进度可能没有保存。
- 脚本依赖 ESJZone 当前页面结构和访问方式，站点更新可能影响抓取功能。

## 开发与构建

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

贡献流程、代码规范和发布要求见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，测试目录与隔离约定见 [`tests/README.md`](tests/README.md)。

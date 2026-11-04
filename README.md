# ESJ Novel Downloader

![Stable](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=stable) ![Pre-release](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?include_prereleases&label=pre-release) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

简体中文 | [繁體中文](README.zh-TW.md)

一个用于 **ESJZone** 的 Tampermonkey 脚本。  
支持 **TXT / EPUB / HTML 下载**，并适配多种页面类型 (小说详情页 / 单章阅读页 / 论坛列表页)。

## 功能特性

- 📚 **多格式导出**: 全本支持 TXT、EPUB 和 HTML，单章支持 TXT 和 HTML。
- 📖 **章节自选下载（Beta）**: 在详情页或论坛列表页浏览原目录，勾选连续或非连续章节，按目录顺序合并导出 TXT、EPUB 或 HTML。
- ⚡ **并发抓取与断点续传**: 支持配置并发数，并通过 IndexedDB 保存全本下载进度。
- 🛡️ **完整性检查与重试**: 下载后检查缺失章节和异常图片，并自动尝试补抓异常内容。
- 🔒 **密码章节处理**: 适配网站加密章节，支持在全本下载过程中识别和解锁。
- 🖼️ **导出内容增强**: 全本 EPUB / HTML 支持封面与正文插图，EPUB 支持书籍元数据和标签。
- 🧾 **下载管理**: 提供缓存管理和下载记录。

> 💡 抓取逻辑部分参考自 [ESJ-novel-backup](https://github.com/ZALin/ESJ-novel-backup)，感谢原项目作者提供的抓取思路

## 页面支持

| 页面类型       | 支持功能                          | 对应模块             | 链接格式示例             |
| :------------- | :-------------------------------- | :------------------- | :----------------------- |
| **小说详情页** | 🟢 全本／自选下载 (TXT/EPUB/HTML) | `ui/pages/detail.ts` | `.../detail/123.html`    |
| **论坛列表页** | 🟢 全本／自选下载 (TXT/EPUB/HTML) | `ui/pages/forum.ts`  | `.../forum/123/456/`     |
| **单章阅读页** | 🔵 单章导出 (TXT/HTML)            | `ui/pages/single.ts` | `.../forum/123/456.html` |

## 安装方式

### 1. 安装脚本管理器

- [Tampermonkey](https://www.tampermonkey.net/) (推荐)
- Violentmonkey

### 2. 安装脚本

已安装旧版的用户请按下方“旧用户升级”操作，避免重复安装。

[👉 **点击这里直接安装最新版**](https://github.com/mikoto710/esj-novel-downloader/releases/latest/download/esj-novel-downloader.user.js)

或前往 [GreasyFork 发布页](https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD) / 本 GitHub 仓库的 [Releases 页面](https://github.com/mikoto710/esj-novel-downloader/releases) 手动下载。

### 3. 旧用户升级

在 Tampermonkey 管理面板对原有脚本执行“检查更新”，不要卸载或重新安装。使用其他管理器时先备份，并确认更新原条目；若已重复安装，停用新副本，保留原条目更新。

## 使用方法

### 全本与自选下载

1. 在小说详情页或论坛列表页点击“下载”。
2. 选择“全本下载”，或使用“自选章节”（Beta）勾选所需章节；可修改文件名。
3. 点击“开始下载”或“下载所选 N 项”，完成后选择 TXT、EPUB 或 HTML 导出。

> 当前页已有成功结果时，可在下载窗口点击“再次导出”。

### 单章导出

使用单章阅读页顶部的 TXT / HTML 下载按钮，导出纯文本或保留排版的单页文件。

### 设置

在小说详情页或论坛列表页点击下载按钮旁的“脚本设置”：

| 选项             | 用途                                                       |
| ---------------- | ---------------------------------------------------------- |
| 下载线程数       | 同时下载的章节数，默认 5。                                 |
| 界面语言         | 自动跟随网站或手动选择简繁，不转换小说正文。               |
| 下载正文插图     | 将插图嵌入 EPUB / HTML，会增加耗时和文件体积；不影响封面。 |
| 生成 EPUB 标签页 | 是否在 EPUB 中生成独立标签页。                             |
| 下载缓存         | 查看或清理下载缓存。                                       |
| 下载记录         | 查看、筛选或清理导出记录。                                 |
| 诊断日志         | 查看任务状态与错误信息。                                   |

部分图片需要在脚本管理器中允许访问对应图片域名。

### 诊断与问题反馈

遇到问题时，从错误弹窗或“脚本设置 → 诊断日志”下载诊断 JSON 或复制摘要，随问题描述一起提供。分享前检查其中的作品名称、链接和失败章节信息是否适合公开。

## 已知问题

- 少数作品因字体限制无法导出 TXT，需用支持内嵌字体的阅读器打开 HTML / EPUB；复制、搜索和朗读可能出现错字。
- 清理站点数据、使用隐私模式或更换浏览器配置文件可能丢失下载进度；存储失败时，最新进度可能无法保存。

## 开发与构建

需要 **Node.js 20.19+**，推荐 **Node.js 22**。

```bash
# 1. 安装依赖
npm ci

# 2. 开发模式：监听文件变更并自动构建
npm run watch

# 3. 使用 Prettier 格式化源码、测试和文档
npm run format

# 4. 类型检查并快速生成本地迭代用 userscript
npm run build:fast

# 5. 完整检查并生成 userscript（提交前执行）
npm run build
```

产物位于 `dist/esj-novel-downloader.user.js`。

开发命令与规范见[贡献指南](CONTRIBUTING.md)，模块职责见[架构说明](docs/architecture.md)，验证场景见[测试指南](docs/testing.md)。

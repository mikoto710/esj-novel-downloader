# ESJ Novel Downloader

![Stable](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=stable) ![Pre-release](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?include_prereleases&label=pre-release) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

[简体中文](README.md) | 繁體中文

一個適用於 **ESJZone** 的 Tampermonkey 使用者腳本。  
支援下載 **TXT / EPUB / HTML**，並適用於多種頁面類型（詳細資料頁／單章閱讀頁／論壇列表頁）。

## 功能特色

- 📚 **多格式匯出**：全本支援 TXT、EPUB 和 HTML，單章支援 TXT 和 HTML。
- 📖 **章節自選下載（Beta）**：在詳細資料頁或論壇列表頁瀏覽原始目錄，勾選連續或不連續章節，依目錄順序合併匯出 TXT、EPUB 或 HTML。
- ⚡ **多執行緒擷取與接續下載**：可設定下載執行緒數，並透過 IndexedDB 儲存全本下載進度。
- 🛡️ **完整性檢查與重試**：下載後檢查缺失章節和異常圖片，並自動嘗試重新擷取異常內容。
- 🔒 **密碼章節處理**：支援網站的密碼保護章節，可在全本下載期間辨識並解鎖。
- 🖼️ **匯出內容強化**：全本 EPUB / HTML 支援封面與內文插圖，EPUB 支援書籍中繼資料和標籤。
- 🧾 **下載管理**：提供快取管理與下載紀錄。

> 💡 部分擷取邏輯參考自 [ESJ-novel-backup](https://github.com/ZALin/ESJ-novel-backup)，感謝原專案作者提供設計思路。

## 支援頁面

| 頁面類型       | 支援功能                          | 對應模組             | 連結格式範例             |
| :------------- | :-------------------------------- | :------------------- | :----------------------- |
| **詳細資料頁** | 🟢 全本／自選下載 (TXT/EPUB/HTML) | `ui/pages/detail.ts` | `.../detail/123.html`    |
| **論壇列表頁** | 🟢 全本／自選下載 (TXT/EPUB/HTML) | `ui/pages/forum.ts`  | `.../forum/123/456/`     |
| **單章閱讀頁** | 🔵 單章匯出 (TXT/HTML)            | `ui/pages/single.ts` | `.../forum/123/456.html` |

## 安裝方式

### 1. 安裝使用者腳本管理器

- [Tampermonkey](https://www.tampermonkey.net/)（建議使用）
- Violentmonkey

### 2. 安裝使用者腳本

已安裝舊版的使用者請依下方「舊使用者升級」操作，避免重複安裝。

[👉 **按一下這裡直接安裝最新版**](https://github.com/mikoto710/esj-novel-downloader/releases/latest/download/esj-novel-downloader.user.js)

也可以前往 [GreasyFork 發布頁](https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD) 或本 GitHub 儲存庫的 [Releases 頁面](https://github.com/mikoto710/esj-novel-downloader/releases) 手動下載。

### 3. 舊使用者升級

在 Tampermonkey 管理面板對原有腳本執行「檢查更新」，請勿解除安裝或重新安裝。使用其他管理器時先備份，並確認更新原有項目；若已重複安裝，停用新副本，保留原有項目更新。

## 使用方式

### 全本與自選下載

1. 在小說詳細資料頁或論壇列表頁按「下載」。
2. 選擇「全本下載」，或使用「自選章節」（Beta）勾選所需章節；可修改檔案名稱。
3. 按「開始下載」或「下載所選 N 項」，完成後選擇 TXT、EPUB 或 HTML 匯出。

> 目前頁面已有成功結果時，可在下載視窗按「再次匯出」。

### 單章匯出

使用單章閱讀頁上方的 TXT / HTML 下載按鈕，匯出純文字或保留排版的單頁檔案。

### 腳本設定

在小說詳細資料頁或論壇列表頁按下載按鈕旁的「腳本設定」：

| 選項             | 用途                                                       |
| ---------------- | ---------------------------------------------------------- |
| 下載執行緒數     | 同時下載的章節數，預設為 5。                               |
| 介面語言         | 自動跟隨網站或手動選擇簡繁，不轉換小說內文。               |
| 下載內文插圖     | 將插圖嵌入 EPUB / HTML，會增加耗時和檔案大小；不影響封面。 |
| 產生 EPUB 標籤頁 | 是否在 EPUB 中產生獨立標籤頁。                             |
| 下載快取         | 檢視或清除下載快取。                                       |
| 下載紀錄         | 檢視、篩選或清除匯出紀錄。                                 |
| 診斷紀錄         | 檢視任務狀態與錯誤資訊。                                   |

部分圖片需要在使用者腳本管理器中允許存取對應圖片網域。

### 診斷與問題回報

遇到問題時，從錯誤視窗或「腳本設定 → 診斷紀錄」下載診斷 JSON 或複製摘要，隨問題描述一併提供。分享前檢查其中的作品名稱、連結和失敗章節資訊是否適合公開。

## 已知問題

- 少數作品因字型限制無法匯出 TXT，需用支援內嵌字型的閱讀器開啟 HTML / EPUB；複製、搜尋和朗讀可能出現錯字。
- 清除網站資料、使用無痕模式或更換瀏覽器設定檔可能遺失下載進度；儲存失敗時，最新進度可能無法儲存。

## 開發與建置

建議使用 **Node.js 22** 的最新修補版本。

```bash
# 1. 安裝相依套件
npm ci

# 2. 開發模式：監聽檔案變更並自動建置
npm run watch

# 3. 使用 Prettier 格式化原始碼、測試與文件
npm run format

# 4. 執行型別檢查並快速產生本機開發用 userscript
npm run build:fast

# 5. 完整檢查並產生 userscript（提交前執行）
npm run build
```

產物位於 `dist/esj-novel-downloader.user.js`。

開發命令與規範見[貢獻指南](CONTRIBUTING.md)，模組職責見[架構說明](docs/architecture.md)，驗證情境見[測試指南](docs/testing.md)。

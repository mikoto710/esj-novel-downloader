# ESJ Novel Downloader

![Stable](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?label=stable) ![Pre-release](https://img.shields.io/github/v/release/mikoto710/esj-novel-downloader?include_prereleases&label=pre-release) ![License](https://img.shields.io/github/license/mikoto710/esj-novel-downloader) ![Language](https://img.shields.io/badge/language-TypeScript-blue)

[简体中文](README.md) | 繁體中文

一個適用於 **ESJZone** 的 Tampermonkey 使用者腳本。  
支援下載 **TXT / EPUB / HTML**，並適用於多種頁面類型（詳細資料頁／單章閱讀頁／論壇列表頁）。

## 功能特色

- 📚 **多格式匯出**：全本支援 TXT、EPUB 和 HTML，單章支援 TXT 和 HTML。
- ⚡ **多執行緒擷取與接續下載**：可設定下載執行緒數，並透過 IndexedDB 儲存全本下載進度。
- 🛡️ **完整性檢查與重試**：下載後檢查缺失章節和異常圖片，並自動嘗試重新擷取異常內容。
- 🔒 **密碼章節處理**：支援網站的密碼保護章節，可在全本下載期間辨識並解鎖。
- 🖼️ **匯出內容強化**：全本 EPUB / HTML 支援封面與內文插圖，EPUB 支援書籍中繼資料和標籤。
- 🧾 **下載管理**：提供快取管理，以及全本與單章的下載紀錄。

> 💡 部分擷取邏輯參考自 [ESJ-novel-backup](https://github.com/ZALin/ESJ-novel-backup)，感謝原專案作者提供設計思路。

## 支援頁面

| 頁面類型       | 支援功能                    | 對應模組             | 連結格式範例             |
| :------------- | :-------------------------- | :------------------- | :----------------------- |
| **詳細資料頁** | 🟢 全本下載 (TXT/EPUB/HTML) | `scrapers/detail.ts` | `.../detail/123.html`    |
| **論壇列表頁** | 🟢 全本下載 (TXT/EPUB/HTML) | `scrapers/forum.ts`  | `.../forum/123/456/`     |
| **單章閱讀頁** | 🔵 單章匯出 (TXT/HTML)      | `scrapers/single.ts` | `.../forum/123/456.html` |

## 安裝方式

### 1. 安裝使用者腳本管理器

- [Tampermonkey](https://www.tampermonkey.net/)（建議使用）
- Violentmonkey

### 2. 安裝使用者腳本

[👉 **按一下這裡直接安裝最新版**](https://github.com/mikoto710/esj-novel-downloader/releases/latest/download/esj-novel-downloader.user.js)

也可以前往 [GreasyFork 發布頁](https://greasyfork.org/zh-CN/scripts/562046-esjzone-%E5%85%A8%E6%9C%AC%E4%B8%8B%E8%BD%BD) 或本 GitHub 儲存庫的 [Releases 頁面](https://github.com/mikoto710/esj-novel-downloader/releases) 手動下載。

## 使用方式

使用者腳本會自動辨識目前的頁面類型，並提供對應的下載入口。

### 全本下載

1. 在小說詳細資料頁或論壇列表頁按一下「全本下載」。
2. 如果有未完成的本機快取，可以接續下載並跳過已完成的章節。
3. 遇到密碼保護章節時，畫面會顯示密碼輸入視窗，可送出密碼解鎖、跳過本章、跳過全部剩餘密碼章節，或取消本次下載。
4. 下載期間可以將進度視窗最小化；按一下「取消任務」會停止擷取，並嘗試儲存目前進度。
5. 下載完成後會自動檢查缺失章節；啟用內文插圖時，也會檢查下載失敗的圖片並嘗試重新擷取。
6. 如果重新擷取後仍有章節缺失，可以選擇：
    - 只重試缺失章節；
    - 加入缺章說明後繼續匯出；
    - 取消並保留快取。
7. 處理完成後，可以選擇匯出 TXT、EPUB 或 HTML。

> 缺章說明只會寫入本次匯出內容，不會儲存到章節快取。

### 單章匯出

單章閱讀頁上方提供以下按鈕：

- **TXT**：匯出目前章節的純文字內容。
- **HTML**：匯出保留排版的單頁檔案；啟用內文插圖後會嘗試嵌入圖片。

> 如果目前章節受密碼保護，需要先在內文區域輸入密碼並完成解鎖。

### 腳本設定

小說詳細資料頁和論壇列表頁的「全本下載」按鈕旁提供「腳本設定」入口：

- **下載執行緒數**：設定同時發出的章節請求數量，預設為 5。
- **介面語言**：可選擇「自動（跟隨網站）」「簡體中文」或「繁體中文」；手動選擇後會儲存設定，並優先於自動判斷。
- **下載內文插圖**：擷取內文圖片並寫入 EPUB / HTML；會增加下載時間、快取佔用空間和檔案大小。
- **產生 EPUB 標籤頁**：控制是否在 EPUB 中產生獨立的標籤頁。
- **快取管理**：檢視或清除下載快取，以及停止執行中的任務。
- **下載紀錄**：檢視和清除全本與單章匯出紀錄。
- **診斷紀錄**：檢視目前任務和最近 7 天內最多 30 筆任務紀錄；單筆上限為 256 KiB，總計上限為 4 MiB。

介面語言只會影響使用者腳本本身的按鈕、視窗、狀態、紀錄和錯誤訊息，不會轉換小說內文或書籍中繼資料，也不會改變 TXT、EPUB 或 HTML 中的小說內容。

內文插圖設定不影響封面。圖片擷取失敗時，使用者腳本會盡量保留原始連結並在結果中提示。部分圖片可能需要由使用者腳本管理器授予跨網域存取權限。

全本任務啟動時會固定本次的插圖設定；任務執行期間在其他頁面修改這項設定，只會影響之後新啟動的任務。

### 診斷與問題回報

下載、快取或匯出發生錯誤時，可以從錯誤視窗或腳本設定中的「診斷紀錄」開啟診斷紀錄，並下載 JSON 或複製摘要。

診斷檔案會包含執行環境、作品名稱與連結、任務設定、匯出結果和失敗章節等資訊。回報下載相關問題時，建議一併提供對應任務的診斷 JSON，方便維護者釐清問題。

## 已知問題

- 少數作品使用自訂映射字型，頁面可正常顯示，但底層文字不一定是真實的 Unicode。這類內容無法匯出 TXT；HTML / EPUB 的顯示效果取決於閱讀器是否支援內嵌字型，複製、搜尋和朗讀也可能出現錯誤字元，同時會讓檔案大小明顯增加。
- 接續下載進度儲存在瀏覽器的 IndexedDB。清除網站資料、使用無痕模式或更換瀏覽器設定檔都可能造成快取遺失；發生儲存失敗時，最新一批進度可能不會寫入。

## 開發與建置

需要 **Node.js 20.19+** 環境；建議使用 **Node.js 22**，與 CI 和發布工作流程保持一致。

```bash
# 1. 安裝相依套件（建議使用 npm ci）
# npm install
npm ci

# 2. 開發模式（監聽檔案變更並自動建置）
npm run watch

# 3. 使用 Prettier 格式化原始碼、測試與受管理文件
npm run format

# 4. 執行型別檢查並快速產生本機開發用 userscript
npm run build:fast

# 5. 執行型別檢查、自動化測試並產生最終 userscript
npm run build
```

`npm run build:fast` 只會執行 TypeScript 型別檢查和 Rollup，不會執行自動化測試、ESLint 或格式檢查，因此不能取代提交、CI 或發布前的完整 `npm run build`。`npm run format` 會直接修改檔案，執行後應檢查差異。建置產物位於 `dist/esj-novel-downloader.user.js`。

貢獻流程、程式碼規範和發布要求請參閱 [`CONTRIBUTING.md`](CONTRIBUTING.md)，測試目錄與隔離規則請參閱 [`tests/README.md`](tests/README.md)。

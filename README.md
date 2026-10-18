# ✍️ HKAT 閱讀理解生成器 / HKAT Comprehension Generator

幫老師「養」一個屬於自己的 HKAT 理解題資料庫，然後一鍵生成新的文章＋題目。

A local web app for Hong Kong primary teachers:

1. 📚 **上載樣本 Upload samples** — 把 HKAT comprehension PDF（或直接貼文字）交給程式，AI 自動抽出文章、題目、答案，存入本機 SQLite 資料庫。重複檔案會自動跳過，資料庫會隨你上載的樣本越來越大。
2. 📊 **風格分析 Analyse** — AI 統計所有樣本的篇幅、程度、題型比例、題干用語、答案格式，寫成一份「風格檔」(style profile)。之後每次上載新樣本，程式會提示你重新分析，令風格越嚟越準。
3. ✨ **生成 Generate** — 選擇：主題、文章大意、字數、程度（小四/小五/小六）、題目數量、題型（選詞填空、事件排序、是非題、錯處更正、代詞指涉、關鍵詞作答、內意連結、生詞詞義）、語言（英文／中文）。AI 會按照你的風格檔＋最相似的幾份真實樣本作參考，寫一份**從未見過的新文章**和完整題目、答案、分數。
4. 🕘 **歷史 History** — 每份生成的練習都會存起來，隨時重看、列印或下載 Markdown。

所有資料只存於你自己的電腦（`data/app.db`），不會上載到任何雲端（AI 呼叫除外）。

## 安裝 / Setup（只需一次）

1. 安裝 [Node.js](https://nodejs.org) LTS 或更新版本（本機已裝 Node 24）。
2. 開啟終端機（PowerShell），進入本資料夾：

```powershell
cd "C:\Users\wayne\OneDrive\文件\預設專案\hkat-generator"
npm install        # 首次才需要
```

3. 啟動：

```powershell
.\start.ps1
```

首次啟動會自動建立 `.env`。打開瀏覽器到 **http://localhost:3000**。

## 設定 AI / AI setup

程式支援任何 **OpenAI 相容 API**：OpenAI、DeepSeek、Groq、OpenRouter、Azure，或本地 Ollama / LM Studio。

**推薦（香港）**：選 **OpenRouter**，模型用 `deepseek/deepseek-chat`（中英文都好、便宜）。「⚙️ 設定」有供應商快速選擇，揀完貼 key 就得。

> ⚠️ 用 OpenRouter 時要注意：
> - Base URL 必須是 `https://openrouter.ai/api/v1`（唔係 OpenAI 嘅網址）
> - 模型名要用「供應商/模型」格式：`deepseek/deepseek-chat`、`qwen/qwen-2.5-72b-instruct`、`meta-llama/llama-3.3-70b-instruct`
> - `openai/…` 同 `google/…`（Gemini）模型喺部分地區會被封鎖（HTTP 403 "not available in your region"）；DeepSeek / Qwen / Llama 冇問題
>
> 設好之後按 **「🔌 測試連接 Test」**，程式會即刻用你嘅設定發一個小請求：成功顯示 ✅，失敗會講明原因同建議改法。

方法二：編輯 `.env`：

```env
OPENAI_API_KEY=sk-or-xxxxxxxx
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=deepseek/deepseek-chat
```

改完 `.env` 要重啟 `start.ps1`。

> 💡 免費試用介面：想未有 key 都睇吓介面，可以用模擬模式：
> `$env:MOCK_AI='1'; node server/index.js`（Windows PowerShell）

## 建議工作流程 / Suggested workflow

1. 先上載 **5–10 份**你學校慣用的 HKAT comprehension PDF（越多越好，建議覆蓋小四至小六）。
2. 等每份都顯示「✅ 已處理」，再按「📊 分析資料庫」。
3. 之後上載更多樣本 → 程式會提示「⚠️ 資料庫已更新」→ 再按一次分析，風格檔會自動更新。
4. 到「✨ 生成」填參數 → 生成 → 預覽、隱藏/顯示答案、列印、下載 Markdown。

## 題型 Question types

| 代號 | 題型 | 說明 |
| --- | --- | --- |
| `cloze` | 選詞填空 | 句子挖空，學生從選項選答案 |
| `sequencing` | 事件排序 | 把事件／步驟排序 |
| `true` | 是非題（True） | 正確陳述，學生寫 T |
| `not_true` | 錯處更正（Not True） | 不正確陳述，學生寫 F＋改正 |
| `referencing` | 代詞指涉 | 「它／這／他們」指甚麼 |
| `keywords` | 關鍵詞作答 | 簡答，用文中關鍵詞 |
| `connection` | 內意連結 | 事件／意思之間的關係 |
| `unfamiliar_word` | 生詞詞義 | 解釋生詞在文中的意思 |

## 常見問題 FAQ

**上載後顯示「❌ 失敗 / PDF 內沒有可抽取的文字」**
那份 PDF 多半是掃描圖片。請用文字版 PDF，或用「貼上文字」功能（可以先用 Word / OCR 貼上內容）。

**顯示「⏸ 待處理 — 尚未設定 AI Key」**
設定好 API Key 後，按該樣本的「🔁 重新處理」即可，不用重新上載。

**生成出來太難／太易？**
檢查「程度 Level」是否選對；也可以在「其他要求」寫明，例如「句子要短，每句不超過 15 字」。

**想換模型？**
在 ⚙️ 設定換 Model 即可。生成長文建議用較強的模型（如 `gpt-4o`、`deepseek-chat`），分析資料庫同樣。

## 檔案結構 / Project structure

```
hkat-generator/
├─ server/          Node + Express 本地伺服器
│  ├─ index.js      API 路由
│  ├─ db.js         SQLite 資料庫（node:sqlite，免安裝原生模組）
│  ├─ pdf.js        PDF 文字抽取及清理（unpdf / pdf.js）
│  ├─ ingest.js     上載 → AI 結構化 → 入庫
│  ├─ analyze.js    資料庫統計 + AI 風格檔
│  ├─ generate.js   生成新文章及題目（風格檔 + 相似樣本作參考）
│  └─ ai.js         OpenAI 相容 API 用戶端
├─ public/          網頁介面（純 HTML/CSS/JS）
├─ data/            app.db 及上載的 PDF（自動建立）
└─ .env             API key 及設定
```

## 資料私隱 / Privacy

- 課文、題目、答案只存於本機 SQLite (`data/app.db`)。
- 只有「分析」及「生成」時，相關文字才會發送到你自己設定的 AI 服務。
- 上載時會做 SHA-256 去重，同一份 PDF 不會重複入庫。

# ✍️ HKAT 閱讀理解生成器 / HKAT Comprehension Generator

幫老師「養」一個屬於自己的 HKAT 理解題資料庫，然後一鍵生成新的文章＋題目。

A local web app for Hong Kong primary teachers:

1. 📚 **上載樣本 Upload samples** — 把 HKAT comprehension PDF、**Word (.docx)** 或相片交給程式（亦可直接貼文字），AI 自動抽出文章、題目、答案，存入本機 SQLite 資料庫。掃描檔會自動 OCR；手機可撳**📸 拍照上載**直接影低紙本做樣本。重複檔案會自動跳過，資料庫會隨你上載的樣本越來越大。
2. 📊 **風格分析 Analyse** — AI 統計所有樣本的篇幅、程度、題型比例、題干用語、答案格式，寫成一份「風格檔」(style profile)。之後每次上載新樣本，程式會提示你重新分析，令風格越嚟越準。題型分類中英獨立（英文 11 類、中文 HKAT 四組 12 類），分析結果會對應翻譯。
3. ✨ **生成 Generate** — 選擇：程度（小四/小五/小六）、語言（英文／中文）、**每種題型的題數**（例如主旨歸納 ×3，總題數自動加總、上限 20）、以及文章來源：
   - **🤖 AI 生成文章** — 選主題、文章大意、字數，AI 按你的風格檔＋最相似的真實樣本，寫一份**從未見過的新文章**同完整題目、答案、分數。
   - **📝 自己貼文章出題** — 貼上現成文章（報章、圖書節選），AI **只為呢篇文章出題、唔會改寫文章**，慳 AI 額度之餘更貼近教學需要。

   **生成模式 Generation modes：**
   - **單份 Single** — 一份練習
   - **3 份變體 Variants** — 同一組參數，生成 3 份故事完全不同的練習（自己貼文章時則是同一篇文章的 3 套不同題目）
   - **分程度 Differentiated set** — 同一個故事，分別寫成小四／小五／小六程度（適合程度差異大的班；自己貼文章時文章保持原樣，只換題目難度）

   **AI 自動檢查 Self-check：** 生成後 AI 會再檢查一次：每條答案係咪真係喺文章入面、字數、程度、題型要求，有錯會自動修正，並俾一個「質量分」(0–100)。

4. 🧑‍🎓 **學生連結 Student mode** — 按一下「學生連結」，把網址發給學生；學生喺瀏覽器作答，交卷即時自動批改，你喺「📊 成績」睇到全班分數同逐題對錯。唔使印、唔使改。

5. ⬇️ **Word 匯出 + 列印版面** — 每份練習都可以下載 .docx：**學生卷**（文章＋題目＋答題線）同**答案卷**（含答案、分數、答案總表），A4 排版直接印得。亦可撳「🖨️ 列印」揀**版本（學生／教師）、答案線數量、字體大小**，喺新分頁開出 A4 版面即場列印。

6. ✏️ **即場編輯 Inline editing** — 生成後直接撳「✏️ 編輯」修改標題、文章、題目、選項、答案、分數，可以刪題、上下移動次序，儲存後即時生效，之後匯出 Word／列印／學生連結都用改咗嘅版本。

7. 🧩 **題庫＋拼卷 Question bank & composer** — 所有生成過的題目自動入題庫，可按語言、程度、題型、關鍵字搜尋篩選；勾選多條題目（可調次序）一鍵**組合成新練習**，例如抽齊三份卷的主旨題拼成「主旨專練」。

8. 🔍 **掃描檔 OCR** — 上載掃描 PDF 或相片，程式會自動辨識文字再交俾 AI 整理（可在「掃描檔設定」揀英文/繁中/中英混合）。

9. 🕘 **歷史 History** — 每份生成的練習都會存起來，隨時重看、下載 Word、發學生連結、睇成績或列印；刪除歷史卷時其題目會同步移出題庫。

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

## 共享資料庫 / Shared seed data

Repo 附帶一份「種子資料庫」（`seed/seed.json`），新老師 **clone 之後第一次啟動**會自動載入：

```
🌱 Loaded shared seed data — samples 6, papers 9, bank items 74
```

即時擁有：
- **6 份已分析範文**（風格庫，可直接攞嚟生成）
- **9 份舊試卷**（可預覽／列印／下載 Word）
- **74 條題庫題目**（可搜尋、拼卷）

> 種子檔**永遠唔會包含**：API key、學生答案。每人嘅 `data/app.db` 都係自己本機私有，互不相通；第一次載入後就算刪走 `seed/` 都唔會影響已有資料。

你自己加咗新範文／試卷之後，想更新共享資料：

```powershell
npm run seed:export     # 重新匯出 seed/seed.json
git add seed/seed.json
git commit -m "Update shared seed data"
git push
```

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
4. 到「✨ 生成」填參數 → 生成 → 預覽、隱藏/顯示答案、✏️ 即場編輯、列印、下載 Markdown。
5. 之後可以到「🧩 題庫」搜尋舊題目，勾選幾條拼成新的練習卷。

## 題型 Question types

生成時每種題型可獨立設定題數（0–10），總題數自動加總（上限 20）。程式會按語言自動使用對應分類：

**英文 EN（11 類）：**

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
| `main_idea` | 主旨歸納 | 段意、最佳標題、文章主旨 |
| `inferring` | 深層推論 | 隱含意思、判斷、推論 |
| `others` | 其他 | 不屬於以上類別的題目 |

**中文 ZH（HKAT 四組 12 類）：**

| 組別 | 代號 | 題型 |
| --- | --- | --- |
| 一、語意與詞彙理解 | `word_meaning` | 詞義辨析與替換 |
| | `pronoun_ref` | 指稱代詞理解（代詞指代） |
| | `sentence_meaning` | 句義／重組解析 |
| 二、文章內容擷取與整理 | `detail_facts` | 細節尋找與直接事實題 |
| | `true_false` | 正誤判斷題 |
| | `info_organising` | 訊息整理與填表／整合題 |
| 三、結構與主旨歸納 | `main_idea` | 主旨與段意歸納 |
| | `structure_infer` | 文章線索與結構推斷 |
| 四、深層理解、推論與賞析 | `inference` | 深層推論（隱含意思） |
| | `character_feeling` | 人物性格與思想感情分析 |
| | `author_purpose` | 寫作意圖與文章實用目的 |
| | `rhetoric` | 修辭手法與寫作手法辨析 |

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
│  ├─ index.js      API 路由（上載／生成／題庫／編輯／列印／分享）
│  ├─ db.js         SQLite 資料庫（node:sqlite，免安裝原生模組；含題庫 bank_items）
│  ├─ pdf.js        PDF 文字抽取及清理（unpdf / pdf.js）
│  ├─ office.js     Word (.docx) 文字抽取（mammoth）
│  ├─ ingest.js     上載 → AI 結構化 → 入庫（含 OCR 後備）
│  ├─ ocr.js        掃描檔／相片 OCR（tesseract.js）
│  ├─ analyze.js    資料庫統計 + AI 風格檔
│  ├─ question-types.js  中英題型分類（EN 11 / ZH 12）及標籤
│  ├─ generate.js   生成新文章及題目（單份／3 變體／分程度；支援自己貼文章）
│  ├─ quality.js    AI 自動檢查＋質量分
│  ├─ mark.js       學生作答自動批改
│  ├─ docx.js       Word 匯出（學生卷／答案卷，可調答案線／字級）
│  ├─ print.js      A4 列印版面（HTML，瀏覽器即場列印）
│  └─ ai.js         OpenAI 相容 API 用戶端（含連接測試）
├─ public/          網頁介面（純 HTML/CSS/JS）＋學生練習頁 student.html
├─ scripts/
│  └─ export-seed.mjs  匯出共享種子資料（npm run seed:export）
├─ seed/
│  └─ seed.json     共享資料：範文風格庫＋舊試卷＋題庫（無 API key、無學生答案）
├─ data/            app.db 及上載的 PDF（自動建立；私有，永不上傳）
└─ .env             API key 及設定（私有，永不上傳）
```

## 資料私隱 / Privacy

- 課文、題目、答案只存於本機 SQLite (`data/app.db`)。
- 只有「分析」及「生成」時，相關文字才會發送到你自己設定的 AI 服務。
- 上載時會做 SHA-256 去重，同一份 PDF 不會重複入庫。
- `seed/seed.json` 公開內容只包含：範文（含抽取全文）、舊試卷、題庫題目；**不包含 API key 同學生答案**。若不想公開某份範文全文，不要重新執行 `seed:export` 即可。

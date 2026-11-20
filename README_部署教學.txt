《問問星球》V4 P0｜Netlify + Supabase 雙人連線版
==========================================

既有正式站 https://rainbow-licorice-078d2c.netlify.app/
V4 P0 開發分支以 main 32edb72 為基準，待確認後才上線。
雙人模式：手機 A 建立房間 → 分享網址給手機 B → B 加入後輪流答題。
同步方式：每約 2.2 秒自動更新，並非 WebSocket 即時連線。

一、Supabase 遷移
既有環境只需執行 supabase/migrations/20261120_v4_ai_usage.sql。它新增 AI 用量表
與 RPC，可重跑。先在獨立測試庫驗證，部署獲確認後才對既有正式資料庫套用。
驗證時先確認既有房間資料可讀，再確認 service_role 可執行 RPC，anon 和
authenticated 均無相關權限。日常清理可移除 30 日以前的用量列。

全新環境依下列步驟準備資料庫：
1. 打開 https://supabase.com/dashboard 建立一個專案。
2. 在 SQL Editor 先執行 supabase/schema.sql，再執行 V4 P0 遷移檔。
3. 在 Supabase Dashboard 的 Connect 或 Settings → API Keys 複製：
   SUPABASE_URL = https://xxxx.supabase.co
   SUPABASE_SECRET_KEY = sb_secret_... （伺服器 Secret Key，不是 Publishable Key）
   若舊專案只有 legacy service_role key，也可使用，但建議新 Secret Key。
   絕對不要將 secret key 貼到聊天、HTML、GitHub 或網頁 JS 中。

二、Netlify 部署（推薦透過 Git 或 Netlify CLI）
1. 開啟 https://app.netlify.com/，登入。
2. 在新的測試站可用「Import an existing project」連接測試分支，再連到獨立測試資料庫。
   Netlify 自動讀取 netlify.toml：公開目錄 public，Function 目錄 netlify/functions。
   本機可執行 npm run dev，使用獨立測試用的環境變數。前端使用原生 ES modules，
   即使只玩單機問答也從本機 HTTP 或已部署網址開啟。
3. 到 Netlify 專案的 Project configuration → Environment variables：
   設定 SUPABASE_URL 和 SUPABASE_SECRET_KEY，使用 Functions 可用的作用範圍。
4. 如需 AI 出題，再設定 OPENAI_API_KEY。OPENAI_MODEL 預設 gpt-4.1-mini，供伴侶與
   腦筋急轉彎使用。OPENAI_NEWS_MODEL 預設 gpt-4.1，供日常知識、科普、歷史與新聞使用，
   需支援 Responses API 的 Structured Outputs 及 web_search。
   OpenAI API 另行計費；沒有 Key 時照樣能使用內建題庫及自訂問答。
5. 重新部署，讓後端 Functions 取得新環境變數。
6. 打開 https://你的網站.netlify.app/api/health
   應顯示 onlineReady:true，表示 Functions 能連上 Supabase。
   aiEnabled:true 代表 Functions 偵測到金鑰欄位。使用測試雙人房間實際生成與寄題，
   才能驗證金鑰、配額、模型、搜尋及遷移均可運作。

注意：只用 Netlify Drop 拖曳 public 靜態 HTML，通常不會一併部署可執行的 Functions。
請使用帶有 netlify.toml + Functions 的完整專案來部署。

三、如何讓兩人異地玩
1. 在 Netlify 正式網址（不是本機 html）打開《問問星球》。
2. 點「邀請另一半」→ 填暱稱 → 「建立雙人房間」。
3. 點「複製邀請連結」，分享給另一半。
4. 對方在手機開啟連結，輸入暱稱 → 「加入房間」。
5. 在「出題工坊」自己輸入問題／參考答案（可留空），另一半直接打字回答。
6. 題庫六類各 25 題，可篩選難度、風格及關鍵字。當下熱點的內建題是媒體識讀練習，
   即時新聞從 AI 搜尋產生。抽完可重置本類的抽題順序。
7. AI 草稿可逐題編輯和核可，再收藏或寄題。草稿及收藏按瀏覽器、房間及玩家保存；
   寄出後的問答進入原本的房間和戰績。跨裝置登入或清除瀏覽器資料後無法取回本機收藏。

四、安全與使用限制
- 真實題目保存在 Supabase，14 天無活動後視為到期；資料庫清理可依 SQL 注解手動執行。
- 雙人邀請碼是 8 位亂碼，只適合熟人私下使用，不要傳私人密碼、證件或其他敏感資料。
- 兩人沒有帳號登入系統；房間碼可能被其他人猜到或經轉傳取得，建議正式上線前再加身份驗證。
- 所有 Supabase / OpenAI 私密 API Key 僅由 Netlify Functions 讀取。
- 使用 Supabase Row Level Security，瀏覽器不直接存取房間資料表。
- AI 每房間每 UTC 日最多 30 題，全站每 UTC 日 300 題，房間兩次請求間隔至少 40 秒。
  通過房間驗證及用量預留後才請求 OpenAI。上游請求開始後，即使逾時、拒答或校驗失敗，
  也保留預留題數，因為上游可能已計費。單次最多 4 次搜尋工具呼叫，另設輸出 token 上限。
  Functions Logs 記錄題數、token 數與搜尋呼叫數。API 控制台可設定預算通知與監看用量。
- 此版本採用定期輪詢更新（約 2.2 秒）；大量同時玩家時可優化為即時推送。
- 日常知識、科普、歷史與時事先取得帶來源的搜尋筆記，再生成結構化草稿。現有房間
  用量限制涵蓋整次請求。即時新聞限定事件距今 30 天內，發布日及事件日須在搜尋筆記中，
  審核時仍需開啟原文核對答案及日期。

五、專案檔案
public/index.html、public/style.css、public/app.js —— 手機／桌面前端與原有房間流程
public/studio.js —— 抽題、AI 草稿與收藏介面
public/question-bank.js、public/question-tools.js —— 靜態題庫、抽題和共用校驗
netlify/functions/api.mjs —— Netlify Functions API 入口（路由 /api/*）
server/api.mjs、server/ai.mjs —— Supabase、房間驗證、限流、AI 請求與校驗
supabase/schema.sql —— Supabase 資料庫建表／RLS
supabase/migrations/20261120_v4_ai_usage.sql —— P0 用量預留及權限
tests/api.test.mjs、tests/question-bank.test.mjs —— API 回歸及題庫測試
netlify.toml —— Netlify 設定（不放密鑰）
.env.example —— 需要自行設定的環境變數名稱

六、技術審查與階段計畫
main 32edb72 使用原生 HTML/CSS/JS、Netlify Functions 和 Supabase REST。房間用
Bearer token 認證，以 JSONB 保存回合及戰績，version 欄位負責並發更新；房間資料
14 天無活動到期。初版有 34 題，AI 只回傳一題、請求前扣房間額度且會把模型的錯誤內容
回傳前端。正式站首頁回傳 HTTP 200；唯讀健康檢查回傳 onlineReady 與 aiEnabled。

P0　新增批量出題、審核收藏、150 題和去重。保留原路由和簡答計分；耗盡後可重置抽題。
P1　先定義房間憑證及權限邊界。貼文字或上傳 TXT／MD／PDF／DOCX 後，驗證實際格式、
    存到私有 Storage，再提供文字預覽、頁碼／段落引用、審核寄題及刪除。文件 metadata、
    段落和關聯題目另建資料表。默契預測先由一人填答並保密，另一人預測後同時揭曉；
    真假故事先由出題方提交三句，再由另一人猜和揭曉。用兩端驗證斷線重連與越權讀取。
P2　新增有互補線索和可恢復進度的合作解謎，以及兩人均作答後才揭曉的每日盲盒。
    長文件加入房間範圍內的段落檢索；抽樣檢查檢索命中、引用定位和跨房間隔離。

七、P0 驗收與上線前檢查
1. 執行 npm test。API 驗證 1／5／10 題、請求格式、權限及上游錯誤；題庫測覆蓋率、
   正解格式、來源、近期去重和耗盡。原有兩人房間、簡答、四選一及戰績測試保留。
2. 在獨立庫重跑遷移兩次，檢查既有房間及戰績、授權角色、冷卻時間及房間／全站用量。
3. 兩個獨立手機視窗測邀請、輪詢過程保留未提交的簡答、答案保密及完成計分。
   在同一類連抽至少 20 題，切換篩選、抽完重置，檢查小視窗有無水平溢出。
4. 在有測試金鑰的獨立環境實測 1／5／10 題、兩種題型和即時新聞。打開來源逐題核對，
   編輯、核可、收藏、重新整理及寄題。移除測試金鑰後再驗證內建題庫能玩。
5. 取得上線確認並通過實際生成後，再套用正式庫遷移、發布正式站，檢查現有房間。
   若需回退 Netlify 版號，AI 用量遷移與房間資料可留在庫中。

排查：
- /api/health 顯示 404 或 HTML：Functions 未部署，請用完整專案匯入而非靜態拖放。
- onlineReady:false：尚未填好 SUPABASE_URL / SUPABASE_SECRET_KEY。
- 顯示「找不到資料表」：尚未執行 SQL。
- 無法建立房間：先查看 Netlify Functions Logs，確認 Supabase Key 正確及已重新部署。
- AI 不能使用：檢查 Functions 環境變數、OpenAI 模型權限／配額和 P0 遷移；內建題庫仍可玩。

《問問星球》V1｜Netlify + Supabase 雙人連線版
==========================================

本專案可部署，但尚未替你建立 Netlify 或 Supabase 帳戶，也沒有公開網址。
保留原本的可愛星球 UI、手機版、六類題庫、簡答題、AI 出題預留。
雙人模式：手機 A 建立房間 → 分享網址給手機 B → B 加入後輪流答題。
同步方式：每約 2.2 秒自動更新，並非 WebSocket 即時連線。

一、先在 Supabase 建立資料庫（約需登入操作）
1. 打開 https://supabase.com/dashboard 建立一個專案。
2. 在 SQL Editor 貼上 supabase/schema.sql 全部內容並執行。
3. 在 Supabase Dashboard 的 Connect 或 Settings → API Keys 複製：
   SUPABASE_URL = https://xxxx.supabase.co
   SUPABASE_SECRET_KEY = sb_secret_... （伺服器 Secret Key，不是 Publishable Key）
   若舊專案只有 legacy service_role key，也可使用，但建議新 Secret Key。
   絕對不要將 secret key 貼到聊天、HTML、GitHub 或網頁 JS 中。

二、Netlify 部署（推薦透過 Git 或 Netlify CLI）
1. 開啟 https://app.netlify.com/，登入。
2. 將本資料夾匯入私人 Git 儲存庫，在 Netlify 選「Import an existing project」連接該儲存庫。
   Netlify 自動讀取 netlify.toml：公開目錄 public，Function 目錄 netlify/functions。
   也可以安裝 Netlify CLI，進入此資料夾執行：
     npx netlify login
     npx netlify init
     npx netlify deploy --build --prod
3. 到 Netlify 專案的 Project configuration → Environment variables：
   設定 SUPABASE_URL 和 SUPABASE_SECRET_KEY，使用 Functions 可用的作用範圍。
4. 如需 AI 出題，再設定 OPENAI_API_KEY；可以設定 OPENAI_MODEL / OPENAI_NEWS_MODEL。
   OpenAI API 另行計費；沒有 Key 時照樣能使用內建題庫及自訂問答。
5. 重新部署，讓後端 Functions 取得新環境變數。
6. 打開 https://你的網站.netlify.app/api/health
   應顯示 onlineReady:true，表示 Functions 能連上 Supabase。
   如果設定了 OPENAI_API_KEY，應顯示 aiEnabled:true。

注意：只用 Netlify Drop 拖曳 public 靜態 HTML，通常不會一併部署可執行的 Functions。
請使用帶有 netlify.toml + Functions 的完整專案來部署。

三、如何讓兩人異地玩
1. 在 Netlify 正式網址（不是本機 html）打開《問問星球》。
2. 點「邀請另一半」→ 填暱稱 → 「建立雙人房間」。
3. 點「複製邀請連結」，分享給另一半。
4. 對方在手機開啟連結，輸入暱稱 → 「加入房間」。
5. 在「出題工坊」自己輸入問題／參考答案（可留空），另一半直接打字回答。
6. 也能使用內建知識題、AI 出題；答題完成後戰績同步。

四、安全與使用限制
- 真實題目保存在 Supabase，14 天無活動後視為到期；資料庫清理可依 SQL 注解手動執行。
- 雙人邀請碼是 8 位亂碼，只適合熟人私下使用，不要傳私人密碼、證件或其他敏感資料。
- 兩人沒有帳號登入系統；房間碼可能被其他人猜到或經轉傳取得，建議正式上線前再加身份驗證。
- 所有 Supabase / OpenAI 私密 API Key 僅由 Netlify Functions 讀取。
- 使用 Supabase Row Level Security，瀏覽器不直接存取房間資料表。
- 若輸入了 OpenAI Key，請在 API 控制台設定預算上限和監控使用量。
- 此版本採用定期輪詢更新（約 2.2 秒）；大量同時玩家時可優化為即時推送。
- 暫不包含付費產品功能、帳號系統或正式站點部署。

五、專案檔案
public/index.html、style.css、app.js —— 手機／桌面前端
netlify/functions/api.mjs —— Netlify Functions API 入口（路由 /api/*）
server/api.mjs —— Supabase CRUD、房間認證、AI 生成及計分邏輯
supabase/schema.sql —— Supabase 資料庫建表／RLS
netlify.toml —— Netlify 設定（不放密鑰）
.env.example —— 需要自行設定的環境變數名稱

排查：
- /api/health 顯示 404 或 HTML：Functions 未部署，請用完整專案匯入而非靜態拖放。
- onlineReady:false：尚未填好 SUPABASE_URL / SUPABASE_SECRET_KEY。
- 顯示「找不到資料表」：尚未執行 SQL。
- 無法建立房間：先查看 Netlify Functions Logs，確認 Supabase Key 正確及已重新部署。
- AI 不能使用：OPENAI_API_KEY 未設定或 API 額度不足；內建題庫仍可玩。

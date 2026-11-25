# 問問星球 V5

V5 首頁使用 Supabase Auth 的電郵與密碼登入。「考考你」和「請開始你的表演」共用一個私人雙人空間。Supabase Realtime 會通知兩端重新讀取資料，瀏覽器亦每 12 秒檢查更新。離線期間送出的互動可在下次登入時接收。

## 環境與資料庫

1. 使用 Node.js 22，執行 `npm ci`、`npm test`、`npm run build`。在本機使用 `npm run dev`。
2. 新的隔離 Supabase 環境先套用 `supabase/schema.sql`，再依順序套用 migrations。既有環境從當前遷移版本繼續。V5 遷移只新增 `v5_*` 資料表、函式、發佈與錄音儲存桶。
3. 在目標 Supabase Auth 管理介面建立兩個固定帳戶，由操作者把已核對的 Auth UUID 填入下列 SQL。欄位 `slot` 限制私人空間最多兩人。

```sql
insert into public.v5_members (user_id, slot, display_name, is_admin) values
  ('ADMIN_AUTH_UUID', 1, '管理員暱稱', true),
  ('PARTNER_AUTH_UUID', 2, '另一位玩家暱稱', false);
```

4. 依 `.env.example` 設定相同 Supabase 專案的網址、公開金鑰與伺服器 Secret Key。Deploy Preview 使用 `PREVIEW_SUPABASE_*` 與正式 Supabase 主機名稱檢查。Netlify Function 只向瀏覽器提供公開金鑰。

既有房間、問答和戰績資料留存在 V4 結構。V5 互動使用兩個已驗證的 Auth UUID，舊房間沒有這個帳戶對應，因此目前的 V5 活動列表從新互動開始。若日後要把舊紀錄顯示在 V5，須先核對哪些舊房間屬於這兩個帳戶。

## Excel 題庫

- 管理員從任一模組開啟「管理題庫」，下載對應模板。第一個工作表的第 1 列為欄位名稱，第 2 列開始填資料。模板的「欄位說明」列出必填欄位與允許值。
- 一次最多 500 筆、2 MiB。先預覽新增、重複、錯誤列，再發布有效新列。資料庫重新檢查重複，增量發布到 Supabase。問答按題目去重，表演按訓練能力加題目去重。比對會正規化全半形、空白及英文字母大小寫。
- 題組名稱與正整數順序一起填。題組中較早的啟用題送出並作答後，下一題才可選。遇到已發送的連續題，編輯會保留歷史次序。
- 管理頁可編輯、停用及從題庫刪除。已發送的內容保存題目快照，Excel 備份的第一頁可再次匯入，第二頁另列啟用或停用狀態。
- 瀏覽器直接錄音最長 3 分鐘，亦可上傳不超過 3 MiB 的 WebM、MP4 或 Ogg 錄音。錄音放在私有儲存桶，只有對應互動的兩位成員可播放。

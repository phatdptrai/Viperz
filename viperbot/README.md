# 🐍 Viper Bot — Deploy lên Render.com

## Cấu trúc project

```
viperbot/
├── server.js          ← Entry point: web server + khởi động bot
├── src/
│   ├── bot.js         ← Discord client, lệnh cơ bản
│   └── music.js       ← Toàn bộ hệ thống nhạc
├── public/
│   └── index.html     ← Landing page bot
├── package.json
├── render.yaml        ← Cấu hình Render tự động
└── .env.example       ← Mẫu biến môi trường
```

## Deploy lên Render.com (FREE)

### Bước 1 — Upload lên GitHub
1. Tạo repo mới trên GitHub (private)
2. Upload toàn bộ thư mục `viperbot/` lên repo

### Bước 2 — Tạo Web Service trên Render
1. Vào https://render.com → **New → Web Service**
2. Kết nối GitHub repo vừa tạo
3. Cấu hình:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free

### Bước 3 — Thêm Environment Variables
Vào tab **Environment** trên Render, thêm:

| Key | Value |
|-----|-------|
| `DISCORD_BOT_TOKEN` | Token bot Discord |
| `YOUTUBE_COOKIE` | Cookie 1 dòng (xem bên dưới) |
| `SPOTIFY_CLIENT_ID` | (tuỳ chọn) |
| `SPOTIFY_CLIENT_SECRET` | (tuỳ chọn) |
| `BOT_OWNER_IDS` | ID Discord của bạn |
| `ALLOWED_CHANNEL_ID` | (để trống = tất cả kênh) |

### Format YOUTUBE_COOKIE
Paste 1 dòng duy nhất, dạng:
```
SID=xxx; SSID=xxx; HSID=xxx; SAPISID=xxx; __Secure-1PSID=xxx; ...
```
Render hỗ trợ env var 1 dòng dài nên không bị cắt như Pterodactyl.

### Bước 4 — Deploy
Nhấn **Deploy** → chờ ~2 phút → Bot online!

## Keep-alive (tránh bot ngủ trên free tier)

Render free tier sleep sau 15 phút không có request. Dùng [UptimeRobot](https://uptimerobot.com) để ping URL `/health` mỗi 10 phút:

1. Đăng ký UptimeRobot miễn phí
2. Thêm monitor: `https://your-app.onrender.com/health`
3. Interval: 10 phút

## Lệnh bot

| Lệnh | Mô tả |
|------|-------|
| `!play <tên/link>` | Phát nhạc YouTube/Spotify |
| `!skip` | Skip bài |
| `!stop` | Dừng & xoá queue |
| `!pause` / `!resume` | Tạm dừng / Tiếp tục |
| `!queue` | Xem danh sách phát |
| `!loop` | Loop bài hiện tại |
| `!loopqueue` | Loop cả queue |
| `!shuffle` | Trộn ngẫu nhiên |
| `!volume <0-200>` | Chỉnh âm lượng |
| `!np` | Bài đang phát |
| `!help` | Xem tất cả lệnh |

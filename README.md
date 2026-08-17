# YouBike 車輛查詢

顯示鄰近 YouBike 站點即時車位與租借狀況的 PWA，支援定位、QR Code 分享與一鍵導航。

A lightweight PWA that shows nearby YouBike station availability in real time, with geolocation, QR code sharing, and one-tap navigation to Google Maps.

## Features

- 📍 依目前位置自動列出最近的 YouBike 站點與距離
- 🚲 即時顯示可借車輛數 / 可還空位數
- 🔄 每 30 秒自動刷新一次
- 📷 顯示 QR Code，方便分享網站給他人
- 🧭 一鍵在 Google Maps 開啟站點導航
- 📱 支援加入主畫面的 PWA（standalone 模式）

## Stack

- 前端：純 HTML / CSS / JavaScript（無框架）
- 後端：[Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)（[`functions/api/youbike.js`](functions/api/youbike.js)）作為 API proxy，抓取 YouBike 官方開放資料並依距離排序

## Local development

```bash
npx wrangler pages dev . --port 1234
```

需要在專案根目錄建立 `.dev.vars`（不會被 commit）：

```
TDX_CLIENT_ID=your_client_id
TDX_CLIENT_SECRET=your_client_secret
```

## Deploy

```bash
npx wrangler pages deploy . --project-name=youbike
```

## License

[MIT](LICENSE)

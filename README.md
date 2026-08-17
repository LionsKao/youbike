# YouBike

顯示鄰近 YouBike 站點即時車位與租借狀況的 PWA，支援定位、QR Code 分享與一鍵導航。

A lightweight PWA showing nearby YouBike station availability in real time, with geolocation, QR code sharing, and one-tap navigation.

## Stack

- Static HTML/CSS/JS frontend
- Cloudflare Pages + Pages Functions (`functions/api/youbike.js`) as the API proxy

## Local development

```bash
npx wrangler pages dev . --port 1234
```

Requires a `.dev.vars` file with `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` (TDX Transport Data eXchange API credentials).

## Deploy

```bash
npx wrangler pages deploy . --project-name=youbike
```

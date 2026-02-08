# X API CORS Proxy (Cloudflare Worker)

Cloudflare Worker that proxies X/Twitter API requests with CORS headers.
Required for production (GitHub Pages) since `api.x.com` does not return CORS headers.

## Prerequisites

1. [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)を作成（無料プランでOK）
2. Node.js 18+ がインストール済みであること

## Deploy

### 1. Wrangler CLI をインストール

```bash
npm install -g wrangler
```

### 2. Cloudflare にログイン

```bash
wrangler login
```

ブラウザが開くので、Cloudflare アカウントで認証する。

### 3. Worker をデプロイ

```bash
cd x-api-proxy
wrangler deploy
```

成功すると以下のようにWorker URLが表示される：

```
Published x-api-proxy (x.xx sec)
  https://x-api-proxy.<account>.workers.dev
```

### 4. yomi 側の設定

表示されたURLをプロジェクトルートの `.env.production` に設定：

```
VITE_X_API_PROXY_URL=https://x-api-proxy.<account>.workers.dev
```

その後アプリをリビルド＆デプロイ：

```bash
npm run build
# GitHub Pages へデプロイ
```

## Cloudflare Dashboard での確認

デプロイ後、[Cloudflare Dashboard](https://dash.cloudflare.com/) > Workers & Pages > `x-api-proxy` で以下を確認できる：

- **Metrics**: リクエスト数、エラー率、レイテンシ
- **Logs**: リアルタイムログ（「Begin log stream」をクリック）
- **Settings > Triggers**: Worker URL やカスタムドメインの確認

### 無料プランの制限

- 1日あたり **100,000 リクエスト**
- CPU時間: リクエストあたり **10ms**
- 個人利用には十分な量

## Local testing

```bash
cd x-api-proxy
wrangler dev
```

ローカルWorkerが `http://localhost:8787` で起動する。

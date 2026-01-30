# yomi Discord Bot

yomiにDiscordチャンネルのメッセージを読み上げさせるためのBotです。

## セットアップ

### 1. Discord Developer Portalでアプリを作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. "New Application" をクリック
3. アプリ名を入力（例: "yomi Bot"）して作成

### 2. Botを作成してトークンを取得

1. 左メニューから "Bot" を選択
2. "Reset Token" をクリックしてトークンをコピー（**このトークンは秘密にしてください**）
3. **MESSAGE CONTENT INTENT** を有効にする（重要！）
   - "Privileged Gateway Intents" セクションで "MESSAGE CONTENT INTENT" をONにする

### 3. Botをサーバーに招待

1. 左メニューから "OAuth2" → "URL Generator" を選択
2. SCOPES: `bot` を選択
3. BOT PERMISSIONS: `Read Messages/View Channels`, `Read Message History` を選択
4. 生成されたURLをコピーしてブラウザで開く
5. Botを追加したいサーバーを選択して招待

### 4. チャンネルIDを取得

1. Discordの設定で「開発者モード」を有効にする
   - ユーザー設定 → アプリの設定 → 詳細設定 → 開発者モード
2. 読み上げたいチャンネルを右クリック
3. "チャンネルIDをコピー" を選択

## 起動

```bash
cd discord-bot
npm install
node bot.cjs --token YOUR_BOT_TOKEN --channel CHANNEL_ID
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--token` | Discord Botトークン（必須） | - |
| `--channel` | 監視するチャンネルID（必須） | - |
| `--port` | WebSocketサーバーポート | 8765 |

### 例

```bash
node bot.cjs --token MTIz... --channel 123456789012345678 --port 8765
```

## yomiでの設定

1. yomiの設定画面を開く
2. "Discord" を有効にする
3. Bot URL に `ws://localhost:8765` を入力（デフォルト）
4. "Start" を押して読み上げ開始

## トラブルシューティング

### メッセージが届かない

- Botがサーバーに参加しているか確認
- Botにチャンネルの閲覧権限があるか確認
- MESSAGE CONTENT INTENTが有効になっているか確認
- チャンネルIDが正しいか確認

### 接続エラー

- Botトークンが正しいか確認
- ファイアウォールでWebSocketポートがブロックされていないか確認

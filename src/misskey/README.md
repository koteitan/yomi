# Misskey.io API リファレンス & クライアント調査

## 概要

MisskeyはクライアントやBot、Webサービス開発用のREST APIとWebSocket Streaming APIを提供しています。

- ベースURL: `https://misskey.io/api`
- WebSocket: `wss://misskey.io/streaming`
- 全てのRESTエンドポイントはPOSTメソッド、JSONボディを使用
- 認証: JSONボディに `i` パラメータとしてアクセストークンを含める

---

## クライアント調査

### 比較表

| クライアント | プラットフォーム | ログイン方法 | デフォルト | Streaming API | ハートビート | 再接続バックオフ | ポーリング | Timeline limit |
|-------------|-----------------|-------------|-----------|---------------|-------------|-----------------|-----------|----------------|
| **Misskey公式** | Web (Vue) | [MiAuth](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/pages/miauth.vue#L53), [OAuth](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/pages/oauth.vue#L29-L66), [Passkey](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkSignin.vue#L119) | Streaming (切替可) | [WebSocket](https://github.com/misskey-dev/misskey/blob/develop/packages/misskey-js/src/streaming.ts#L86) | [60秒](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/stream.ts#L12) | [指数バックオフ](https://github.com/misskey-dev/misskey/blob/develop/packages/misskey-js/src/streaming.ts#L86) | [10-22.5秒](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkStreamingNotesTimeline.vue#L244-L249) | - |
| **yomi** | Web (React) | [トークン](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L49-L71) | Streaming のみ | [WebSocket](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L301-L388) | [1分](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L34) | [指数バックオフ](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L45-L48) | なし | [1](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L177) |
| **Miria** | iOS/Android (Flutter) | [MiAuth](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/view/login_page/mi_auth_login.dart#L31-L49), [パスワード](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/account_repository.dart#L354-L378), [トークン](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/account_repository.dart#L380-L407) | Streaming のみ | [WebSocket](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/socket_timeline_repository.dart#L19-L20) | なし | [自動再接続](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/socket_timeline_repository.dart#L146-L177) | なし | [30](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/home_time_line_repository.dart#L17-L26) |
| **Aria** | iOS/Android (Flutter) | [MiAuth](https://github.com/poppingmoon/aria/blob/main/lib/repository/miauth_repository.dart#L53-L65) | Streaming のみ | [WebSocket](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L23-L46) | [1分](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L37) | [指数バックオフ](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L14-L20) | なし | [30](https://github.com/poppingmoon/aria/blob/main/lib/provider/api/timeline_notes_notifier_provider.dart#L22-L26) |
| **Kimis** | iOS/macOS (Swift) | [MiAuth](https://github.com/Lakr233/Kimis/blob/main/Kimis/Interface/Controller/LoginController/LoginController.swift#L314-L322) | Polling のみ | なし | - | - | [2-5秒通知](https://github.com/Lakr233/Kimis/blob/main/Foundation/Source/Sources/Source/DataSource/Notification/NotificationSource%2BFetcher.swift#L23-L26), [5分ステータス](https://github.com/Lakr233/Kimis/blob/main/Kimis/Backend/Account/Account.swift#L32) | - |
| **Mistdon** | デスクトップ (Electron) | [OAuth](https://github.com/tizerm/Mistdon/blob/master/src/js/mist_auth.js#L190), [トークン](https://github.com/tizerm/Mistdon/blob/master/src/js/mist_auth.js#L215-L216) | Streaming (切替可) | [WebSocket](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_account.js#L843-L883) | なし | [自動再接続](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_account.js#L899-L909) | [1-999分設定可能](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L209) | [30](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L58) |

### 詳細分析

#### Misskey公式 (Vue)
- **リポジトリ**: https://github.com/misskey-dev/misskey
- **読み上げ**: 未実装
- **ログイン方法**:
  - [MiAuth](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/pages/miauth.vue#L53) - `misskeyApi('miauth/gen-token')`
  - [OAuth](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/pages/oauth.vue#L29-L66) - 標準OAuth2
  - [Passkey](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkSignin.vue#L119) - `signin-with-passkey`
  - [セッション認証](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/pages/auth.vue#L78-L87)
- **Timeline API**:
  - [10種類以上のタイムライン](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkStreamingNotesTimeline.vue#L116-L177): home, local, hybrid, global, mentions, directs, list, channel, antenna, role
  - [Paginator使用](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkStreamingNotesTimeline.vue#L116-L122)
- **Streaming API**:
  - [ReconnectingWebSocket](https://github.com/misskey-dev/misskey/blob/develop/packages/misskey-js/src/streaming.ts#L86) - 自動再接続対応
  - [ハートビート: 60秒](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/stream.ts#L12)
  - [複数チャンネル同時接続](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkStreamingNotesTimeline.vue#L300-L348)
- **ポーリング** (リアルタイムモード無効時):
  - [最小10秒、設定により10-22.5秒](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/components/MkStreamingNotesTimeline.vue#L244-L249)
  - [ウィジェット更新: 60秒](https://github.com/misskey-dev/misskey/blob/develop/packages/frontend/src/widgets/WidgetFederation.vue#L77)

#### yomi (このアプリ)
- **リポジトリ**: https://github.com/koteitan/yomi
- **読み上げ**: **実装済み** (Web Speech API使用)
- **ログイン方法**: アクセストークン直接入力
- **Timeline API**: `notes/timeline` ([limit: 1](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L177)) - streaming主体のため最小限
- **Streaming API**:
  - [WebSocket接続](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L356)
  - [homeTimelineチャンネル購読](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L367-L378)
  - [1分ウォッチドッグ](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L34) - メッセージがなければ再接続
  - [指数バックオフ再接続](https://github.com/koteitan/yomi/blob/main/src/misskey/index.ts#L45-L48) (1秒〜60秒)

#### Miria (Flutter)
- **リポジトリ**: https://github.com/shiosyakeyakini-info/miria
- **読み上げ**: 未実装
- **ログイン方法**:
  - [MiAuth](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/view/login_page/mi_auth_login.dart#L31-L49) (OAuth風、外部ブラウザ使用)
  - [パスワードログイン](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/account_repository.dart#L354-L378)
  - [直接トークン入力](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/account_repository.dart#L380-L407)
- **Timeline API**:
  - [`notes/timeline`](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/home_time_line_repository.dart#L17-L26) (limit: 30)
  - 8種類のタイムライン対応 (home, local, global, hybrid, antenna, channel, role, userList)
- **Streaming API**:
  - [WebSocket接続](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/socket_timeline_repository.dart#L19-L20)
  - [接続タイムアウト: 20秒](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/providers.dart#L74)
  - [自動再接続](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/socket_timeline_repository.dart#L146-L177)
- **ポーリング**: [10秒間隔で購読クリーンアップ](https://github.com/shiosyakeyakini-info/miria/blob/master/lib/repository/time_line_repository.dart#L106)

#### Aria (Flutter)
- **リポジトリ**: https://github.com/poppingmoon/aria
- **読み上げ**: 未実装
- **ログイン方法**: [MiAuth](https://github.com/poppingmoon/aria/blob/main/lib/repository/miauth_repository.dart#L53-L65) (53種類の権限を要求)
- **Timeline API**:
  - [`notes/timeline`](https://github.com/poppingmoon/aria/blob/main/lib/provider/api/timeline_notes_notifier_provider.dart#L51-L159) (limit: 30)
  - 12種類以上のタイムライン対応
  - カーソルベースのページネーション (`untilId`)
- **Streaming API**:
  - [WebSocket接続](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L23-L46)
  - [Ping間隔: 1分](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L37)
  - [接続タイムアウト: 20秒](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L38)
  - [指数バックオフによる再接続](https://github.com/poppingmoon/aria/blob/main/lib/provider/streaming/web_socket_channel_provider.dart#L14-L20)
- **ポーリング**:
  - [絵文字キャッシュ: 10分](https://github.com/poppingmoon/aria/blob/main/lib/provider/emojis_notifier_provider.dart#L24)
  - [投稿自動保存: 3秒](https://github.com/poppingmoon/aria/blob/main/lib/provider/post_notifier_provider.dart)

#### Kimis (Swift/iOS)
- **リポジトリ**: https://github.com/Lakr233/Kimis
- **読み上げ**: 未実装
- **ログイン方法**:
  - [MiAuth](https://github.com/Lakr233/Kimis/blob/main/Kimis/Interface/Controller/LoginController/LoginController.swift#L314-L322) (ブラウザでOAuth認証)
  - 認証ポーリング: 3秒間隔
  - トークンはAES暗号化で保存
- **Timeline API**:
  - `notes_timeline`, `notes_global_timeline`, `notes_hybrid_timeline`, `notes_local_timeline`
  - ページネーション: `sinceId`, `untilId`, `sinceDate`, `untilDate`
- **Streaming API**: **未実装** (HTTPポーリングのみ)
- **ポーリング**:
  - [通知: 2-5秒 (スロットリング)](https://github.com/Lakr233/Kimis/blob/main/Foundation/Source/Sources/Source/DataSource/Notification/NotificationSource%2BFetcher.swift#L23-L26)
  - [ステータス更新: 5分](https://github.com/Lakr233/Kimis/blob/main/Kimis/Backend/Account/Account.swift#L32)

#### Mistdon (Electron/JavaScript)
- **リポジトリ**: https://github.com/tizerm/Mistdon
- **読み上げ**: 未実装
- **ログイン方法**: [OAuth](https://github.com/tizerm/Mistdon/blob/master/src/js/mist_auth.js#L190) (Mastodon/Misskey両対応)、[レガシートークン入力](https://github.com/tizerm/Mistdon/blob/master/src/js/mist_auth.js#L215-L216)
- **Timeline API**:
  - Misskey: [`notes/timeline`](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L79-L92) (POST, [limit: 30](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L58))
  - ページネーション: `sinceId`, `untilId`
- **Streaming API**:
  - [WebSocket接続](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_account.js#L843-L883)
  - [自動再接続](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_account.js#L899-L909)
  - [ノートキャプチャ機能](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L285-L317) (最大30ノート同時追跡)
- **ポーリング**: [1-999分 (ユーザー設定可能)](https://github.com/tizerm/Mistdon/blob/master/src/js/module/class_timeline.js#L209)

### 調査結果まとめ

1. **読み上げ機能**: 公式含む全5クライアントで**未実装** → yomiの独自機能
2. **ログイン方法**: MiAuthが主流、公式はPasskey/OAuthもサポート
3. **Streaming API**: 5/6のクライアントがWebSocket使用 (Kimisのみポーリング)
   - **デフォルト設定**:
     - Streaming のみ: yomi, Miria, Aria
     - Streaming (切替可): 公式, Mistdon
     - Polling のみ: Kimis
4. **Timeline取得**: 他クライアントは `limit: 30` が標準、yomiは `limit: 1`（streaming主体のため）
5. **ハートビート**: 公式は60秒、yomi・Ariaは1分、他はなし
6. **再接続バックオフ**:
   - 公式・yomi・Aria: 指数バックオフ
   - Miria・Mistdon: 自動再接続（詳細不明）
7. **ポーリング**:
   - 公式: 10-22.5秒（リアルタイムモード無効時）
   - Kimis: 2-5秒通知、5分ステータス（WebSocketなし）
   - Mistdon: 1-999分（設定可能）
   - yomi・Miria・Aria: なし（WebSocketのみ）

---

## レートリミット

### 基本情報

- レートリミット情報は**レスポンスヘッダーに含まれない**（`X-RateLimit-*` ヘッダーなし）
- サーバー側でRedisを使用して制限を実施
- 制限超過時は `429 Too Many Requests` または `RATE_LIMIT_EXCEEDED` エラーを返却
- インスタンス管理者がロールごとにレートリミットを調整可能

参照: [GitHub Discussion #10023](https://github.com/misskey-dev/misskey/discussions/10023)

### レートリミットの構造

Misskeyは2層のレートリミットシステムを採用:

1. **短期（minInterval）**: 連続リクエストを防止
2. **長期（duration/max）**: 期間内の累積リクエスト制限

エンドポイントごとに以下のパラメータで定義:
- `duration`: 時間窓（例: `ms('1hour')`）
- `max`: その期間内の最大リクエスト数

### 既知のエンドポイント別レートリミット

| エンドポイント | 期間 | 最大リクエスト数 | 備考 |
|---------------|------|-----------------|------|
| `notes/create` | 1時間 | 300 | ノート投稿 |
| `notes/timeline` | - | - | 明示的制限なし |
| `notes/reactions/create` | - | - | 明示的制限なし |
| `channels/create` | 1時間 | 10 | チャンネル作成 |
| `drive/files/upload-from-url` | 1時間 | 60 | URLからファイルアップロード |
| `ap/show` | 1時間 | 30 | ActivityPub検索 |
| `i` | - | - | 明示的制限なし |

参照: [Misskey GitHubリポジトリ](https://github.com/misskey-dev/misskey)

---

## WebSocket Streaming API

### 接続

```
wss://misskey.io/streaming?i={accessToken}
```

トークンを省略すると未認証（機能制限あり）で接続可能。

### チャンネル

チャンネルに接続:
```json
{
  "type": "connect",
  "body": {
    "channel": "homeTimeline",
    "id": "unique-id"
  }
}
```

チャンネルから切断:
```json
{
  "type": "disconnect",
  "body": {
    "id": "unique-id"
  }
}
```

### 利用可能なチャンネル

| チャンネル | 説明 |
|-----------|------|
| `homeTimeline` | ホームタイムライン（フォロー中のユーザー） |
| `localTimeline` | ローカルタイムライン |
| `hybridTimeline` | ソーシャルタイムライン（ローカル + フォロー） |
| `globalTimeline` | グローバルタイムライン（連合） |
| `main` | 通知、メンションなど |

### メッセージ形式

受信:
```json
{
  "type": "channel",
  "body": {
    "id": "unique-id",
    "type": "note",
    "body": { /* ノートオブジェクト */ }
  }
}
```

### 接続制限

- **ドキュメント化されていない** - 接続制限はインスタンス固有
- 推奨: 指数バックオフによる再接続の実装
- 単一接続で複数チャンネルの購読が可能

参照: [Misskey Hub - Streaming API](https://misskey-hub.net/en/docs/for-developers/api/streaming/)

---

## タイムラインの制限事項

- `notes/timeline`、`notes/hybrid-timeline`、`notes/local-timeline`: **過去30日分のみ**取得可能
- `notes/global-timeline`: 時間制限なし

参照: [GitHub Issue #10063](https://github.com/misskey-dev/misskey/issues/10063)

---

## このアプリ(yomi)で使用するエンドポイント

### `i` - 自分のプロフィール取得
```
POST /api/i
Body: { "i": "access_token" }
```
認証ユーザーのプロフィールを返却。

### `notes/timeline` - ホームタイムライン取得
```
POST /api/notes/timeline
Body: { "i": "access_token", "limit": 50, "sinceId": "optional" }
```
ホームタイムラインの投稿を返却（1リクエストあたり最大100件）。

### `notes/create` - ノート投稿
```
POST /api/notes/create
Body: { "i": "access_token", "text": "内容" }
```
レートリミット: 300回/時間

### `notes/reactions/create` - リアクション追加
```
POST /api/notes/reactions/create
Body: { "i": "access_token", "noteId": "xxx", "reaction": "❤" }
```

### WebSocket Streaming
```
wss://misskey.io/streaming?i={accessToken}
```
homeTimelineチャンネルを購読してリアルタイム更新を受信。

---

## エラーハンドリング

主なエラーレスポンス:
- `RATE_LIMIT_EXCEEDED`: リクエスト数超過
- `AUTHENTICATION_FAILED`: 無効なトークン
- `PERMISSION_DENIED`: 必要な権限がない

---

## 参考資料

### 公式ドキュメント
- [Misskey Hub - APIドキュメント](https://misskey-hub.net/ja/docs/for-developers/api/)
- [Misskey Hub - Streaming API](https://misskey-hub.net/ja/docs/for-developers/api/streaming/)
- [Misskey GitHubリポジトリ](https://github.com/misskey-dev/misskey)

### GitHub Discussions
- [APIレートリミットに関するDiscussion](https://github.com/misskey-dev/misskey/discussions/10023)
- [ロールのレートリミットに関するDiscussion](https://github.com/misskey-dev/misskey/discussions/12326)

### クライアント
- [Misskey公式](https://github.com/misskey-dev/misskey) - Vue製、公式Webクライアント
- [yomi](https://github.com/koteitan/yomi) - React製、読み上げ機能付き
- [Miria](https://github.com/shiosyakeyakini-info/miria) - Flutter製、iOS/Android
- [Aria](https://github.com/poppingmoon/aria) - Flutter製、Miriaフォーク
- [Kimis](https://github.com/Lakr233/Kimis) - Swift製、iOS/macOS
- [Mistdon](https://github.com/tizerm/Mistdon) - Electron製、Mastodon/Misskey統合

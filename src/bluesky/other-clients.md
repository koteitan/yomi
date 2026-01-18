# Other Bluesky Clients Research

調査対象: tmp/clients/ の5クライアント

## 1. セッション保存方法

| Client | Storage Method | Key/DB Name | TTL |
|--------|---------------|-------------|-----|
| social-app (公式) | localStorage (Web) / AsyncStorage (Native) | `BSKY_STORAGE` | なし |
| tokimekibluesky | IndexedDB (Dexie) + localStorage | `accountDatabase` | なし |
| the-blue | Cookie | `AozoraUserData` | 7日 |
| deckblue | localStorage (暗号化) | `auth_session`, `session-data` | なし |
| atproto-website | (ドキュメントのみ) | - | - |

### 結論
**localStorageは一般的な方法**。公式アプリも使用している。

### 詳細

#### social-app (公式Blueskyアプリ)
```typescript
// src/state/persisted/index.web.ts
const BSKY_STORAGE = 'BSKY_STORAGE'

function writeToStorage(value: Schema) {
  localStorage.setItem(BSKY_STORAGE, rawData)
}

function readFromStorage(): Schema | undefined {
  rawData = localStorage.getItem(BSKY_STORAGE)
}
```

#### tokimekibluesky
```typescript
// src/lib/db.ts - IndexedDBでアカウント情報保存
export class AccountSubClassDexie extends Dexie {
  accounts: Table<Account>;
  // schema: session, did, avatar, name, etc.
}

// src/lib/stores.ts - localStorageで設定保存
export const settings = writable(JSON.parse(localStorage.getItem('settings') || '{}'));
```

#### the-blue
```typescript
// plugins/atp.ts - Cookieでセッション保存
this.ctx.app.$cookies.set(COOKIE_KEY.user_data, sess, {
  maxAge: 60 * 60 * 24 * 7,  // 7日間
})
```

#### deckblue (Flutter Web)
```javascript
// main.dart.js (minified) - localStorageに暗号化保存
// キー: auth_session, session-data
// publicKeyを使った暗号化ストレージ機構あり
window.localStorage.setItem(key + "." + name, encryptedData)
```

---

## 2. タイムライン取得API

全クライアントが同じAPIを使用:
```typescript
agent.api.app.bsky.feed.getTimeline({ limit, cursor })
```

### パラメータ (公式仕様)
| Parameter | Type | Default | Max |
|-----------|------|---------|-----|
| limit | integer | 50 | 100 |
| cursor | string | - | - |
| algorithm | string | - | - |

---

## 3. ポーリング間隔

| Client | Interval | Method |
|--------|----------|--------|
| social-app (公式) | 60秒 (通常) / 300秒 (バックグラウンド) | setInterval + AppState監視 |
| tokimekibluesky | OFF (デフォルト) / 10秒〜30分 (設定可能) | 1秒タイマー + モジュロ演算 |
| the-blue | 15秒 (コメントアウト状態) | setInterval |
| deckblue | 不明 (コード難読化) | setInterval |

### 詳細

#### social-app (公式)
```typescript
// src/state/messages/events/const.ts
export const DEFAULT_POLL_INTERVAL = 60e3          // 60秒
export const BACKGROUND_POLL_INTERVAL = 60e3 * 5   // 300秒 (5分)

// src/view/com/posts/PostFeed.tsx
useEffect(() => {
  const i = setInterval(() => {
    checkForNew()
  }, pollInterval)
  return () => clearInterval(i)
}, [pollInterval])
```

#### tokimekibluesky
```typescript
// src/lib/workers/timer.ts - Web Workerで1秒タイマー
const delay = 1000;
setInterval(() => {
  counter = counter + 1;
  self.postMessage(counter);
}, delay);

// src/lib/components/column/ColumnRefreshButton.svelte
if (e.data % Number(column.settings.autoRefresh) === 0) {
  refresh(true);  // autoRefresh秒ごとに更新
}
```

---

## 4. yomi 現在の実装

| 項目 | 実装 |
|------|------|
| セッション保存 | localStorage (`bluesky_session`) |
| ポーリング間隔 | 5秒 |
| 新着チェック | peekLatest (limit=1) → getTimeline |

### peekLatest方式
```typescript
// 15秒ごと:
const hasNew = await bluesky.peekLatest(since);  // limit=1 で軽量チェック
if (!hasNew) return;  // 新着なければスキップ
const posts = await bluesky.getTimeline(since);  // 新着あれば全件取得
```

TTS読み上げアプリなのでバックグラウンドでも15秒間隔を維持。

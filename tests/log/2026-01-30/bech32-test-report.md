# Bech32/NIP-19 テスト設計レポート

## 1. テスト対象

`src/nostr/bech32.ts` の独自Bech32/NIP-19実装

### 対象関数

| 関数 | 説明 | 実際の使用箇所 |
|------|------|----------------|
| `npubEncode(hex)` | 32バイトhex公開鍵 → `npub1...` | `hexToNpub()` in utils.ts |
| `neventEncode({id})` | イベントID → `nevent1...` | `hexToNevent()` in utils.ts |
| `nip19Decode(bech32)` | `npub1...` → hex | `parseHexOrNpub()` in utils.ts |
| `hexToBytes(hex)` | hex文字列 → Uint8Array | 内部使用 |
| `bytesToHex(bytes)` | Uint8Array → hex文字列 | 内部使用 |

## 2. テスト方針

### 2.1 比較テスト（Oracle Testing）
- `nostr-tools`の出力を正解として比較
- 同一入力に対して同一出力を確認

### 2.2 テストカテゴリ
1. **境界値テスト** - エッジケースの検証
2. **ランダムテスト** - 多様な入力での動作確認
3. **ラウンドトリップテスト** - エンコード→デコードの一貫性
4. **エラーケーステスト** - 不正入力の処理

## 3. テストケース詳細

### 3.1 npubEncode テスト

#### 境界値テスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 全ゼロ | `"0" × 64` | nostr-toolsと一致 |
| 全FF | `"f" × 64` | nostr-toolsと一致 |
| 交互パターン(aa) | `"aa" × 32` | nostr-toolsと一致 |
| 交互パターン(55) | `"55" × 32` | nostr-toolsと一致 |
| 実際のpubkey | `"4c5d5379..."` | nostr-toolsと一致 |

#### ランダムテスト
- 10回のランダム64文字hex入力
- 各回でnostr-toolsと出力を比較

#### エラーケーステスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 短すぎる | `"abc"` | 例外をスロー |
| 63文字 | `"0" × 63` | 例外をスロー |
| 65文字 | `"0" × 65` | 例外をスロー |

### 3.2 neventEncode テスト

#### 境界値テスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 全ゼロID | `{id: "0" × 64}` | nostr-toolsと一致 |
| 全FF ID | `{id: "f" × 64}` | nostr-toolsと一致 |
| 既知パターン | `{id: "a1b2c3..."}` | nostr-toolsと一致 |

#### ランダムテスト
- 10回のランダム64文字hex ID入力
- 各回でnostr-toolsと出力を比較

#### エラーケーステスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 短いID | `{id: "abc"}` | 例外をスロー |

### 3.3 nip19Decode テスト

#### 境界値テスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 全ゼロnpub | `npubEncode("0" × 64)` | type="npub", data一致 |
| 全FF npub | `npubEncode("f" × 64)` | type="npub", data一致 |
| 既知npub | `npubEncode("4c5d...")` | type="npub", data一致 |

#### ランダムテスト
- 10回のランダムnpub入力
- 各回でtype, dataをnostr-toolsと比較

#### エラーケーステスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 無効な文字列 | `"invalid"` | null を返す |
| 不正なチェックサム | `"npub1invalid"` | null を返す |

### 3.4 ラウンドトリップテスト

| テストケース | 処理 | 期待動作 |
|-------------|------|---------|
| npub往復 × 5 | hex → npubEncode → nip19Decode | 元のhexと一致 |

### 3.5 hexToBytes / bytesToHex テスト

| テストケース | 入力 | 期待動作 |
|-------------|------|---------|
| 00 | `"00"` | 往復で一致 |
| ff | `"ff"` | 往復で一致 |
| deadbeef | `"deadbeef"` | 往復で一致 |
| 64文字ゼロ | `"0" × 64` | 往復で一致 |

## 4. テスト結果サマリー

```
=== Test Summary ===
Passed: 69
Failed: 0
```

### 内訳

| カテゴリ | テスト数 |
|---------|---------|
| npubEncode 境界値 | 5 |
| npubEncode ランダム | 10 |
| npubEncode エラー | 3 |
| neventEncode 境界値 | 3 |
| neventEncode ランダム | 10 |
| neventEncode エラー | 1 |
| nip19Decode 境界値 | 6 |
| nip19Decode ランダム | 20 |
| nip19Decode エラー | 2 |
| ラウンドトリップ | 5 |
| hex変換 | 4 |
| **合計** | **69** |

## 5. テスト実行方法

```bash
npx tsx tests/bech32.test.ts
```

## 6. 備考

- テストは`nostr-tools`をdevDependencyとして使用
- プロダクションビルドには`nostr-tools`は含まれない
- 独自実装はBIP-173仕様に基づいて作成

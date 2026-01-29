# Bech32実装 ライセンス比較レポート

## 1. 比較対象

| 項目 | nostr-tools / @scure/base | yomi独自実装 |
|------|---------------------------|--------------|
| ファイル | `node_modules/@scure/base/lib/esm/index.js` | `src/nostr/bech32.ts` |
| ライセンス | MIT | MIT (yomi) |
| 依存関係 | @noble/hashes, @scure/base | なし（独自実装） |

## 2. アーキテクチャ比較

### @scure/base のアプローチ
```
chain() → radix2() → alphabet() → join() → 関数合成
```
- 関数型プログラミングスタイル
- `chain()`による関数合成パターン
- 汎用的なbase変換ライブラリ

### yomi独自実装のアプローチ
```
個別関数 → 直接的なビット操作 → シンプルな構造
```
- 手続き型スタイル
- NIP-19に必要な機能のみ実装
- 依存関係なし

## 3. コード比較

### 3.1 Polymod関数

**@scure/base:**
```javascript
function bech32Polymod(pre) {
    const b = pre >> 25;
    let chk = (pre & 0x1ffffff) << 5;
    for (let i = 0; i < POLYMOD_GENERATORS.length; i++) {
        if (((b >> i) & 1) === 1)
            chk ^= POLYMOD_GENERATORS[i];
    }
    return chk;
}
```

**yomi独自実装:**
```typescript
function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATOR[i];
      }
    }
  }
  return chk;
}
```

**差異:**
- @scure/base: 1値ずつ処理、外部で呼び出しループ
- yomi: 配列を受け取り内部でループ、初期値1から開始
- 変数名: `pre`/`b` vs `values`/`top`
- 構造: 完全に異なる

### 3.2 チェックサム生成

**@scure/base:**
```javascript
function bechChecksum(prefix, words, encodingConst = 1) {
    const len = prefix.length;
    let chk = 1;
    for (let i = 0; i < len; i++) {
        const c = prefix.charCodeAt(i);
        chk = bech32Polymod(chk) ^ (c >> 5);
    }
    chk = bech32Polymod(chk);
    for (let i = 0; i < len; i++)
        chk = bech32Polymod(chk) ^ (prefix.charCodeAt(i) & 0x1f);
    for (let v of words)
        chk = bech32Polymod(chk) ^ v;
    for (let i = 0; i < 6; i++)
        chk = bech32Polymod(chk);
    chk ^= encodingConst;
    return BECH_ALPHABET.encode(convertRadix2([chk % 2 ** 30], 30, 5, false));
}
```

**yomi独自実装:**
```typescript
function hrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const c of hrp) {
    result.push(c.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const c of hrp) {
    result.push(c.charCodeAt(0) & 31);
  }
  return result;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const result: number[] = [];
  for (let i = 0; i < 6; i++) {
    result.push((mod >> (5 * (5 - i))) & 31);
  }
  return result;
}
```

**差異:**
- @scure/base: インライン処理、エンコード済み文字列を返す
- yomi: hrpExpand分離、5ビット配列を返す（エンコードは別）
- 変数名: `chk`/`len` vs `result`/`mod`
- 戻り値: 文字列 vs 数値配列

### 3.3 ビット変換

**@scure/base:**
```javascript
// radix2(5) を使用した汎用変換
// chain()による関数合成で実装
```

**yomi独自実装:**
```typescript
function convertBits8to5(data: Uint8Array): number[] {
  const result: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) {
    result.push((acc << (5 - bits)) & 31);
  }
  return result;
}
```

**差異:**
- @scure/base: 汎用radix変換、関数合成
- yomi: 8→5ビット専用、直接実装
- 完全に異なるアプローチ

### 3.4 エンコード関数

**nostr-tools (nip19.js):**
```javascript
function npubEncode(hex) {
  return encodeBytes("npub", hexToBytes2(hex));
}

function encodeBytes(prefix, bytes) {
  return encodeBech32(prefix, bytes);
}

function encodeBech32(prefix, data) {
  let words = bech32.toWords(data);
  return bech32.encode(prefix, words, Bech32MaxSize);
}
```

**yomi独自実装:**
```typescript
export function npubEncode(hex: string): string {
  if (hex.length !== 64) {
    throw new Error('Invalid pubkey length: must be 64 hex characters');
  }
  const bytes = hexToBytes(hex);
  return bech32Encode('npub', bytes);
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const data5bit = convertBits8to5(data);
  const checksum = createChecksum(hrp, data5bit);
  const combined = data5bit.concat(checksum);
  return hrp + '1' + combined.map((d) => CHARSET[d]).join('');
}
```

**差異:**
- nostr-tools: @scure/baseのbech32.encode()に委譲
- yomi: 自前でビット変換→チェックサム→文字列組立
- エラー処理: yomiは入力長チェックあり

## 4. 定数値について

### GENERATOR / POLYMOD_GENERATORS
```
[0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
```

**これは同一だが問題なし:**
- BIP-173仕様で定義された数学的定数
- BCH符号の生成多項式から導出
- 仕様準拠のため必ずこの値になる

### CHARSET
```
'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
```

**これも同一だが問題なし:**
- BIP-173仕様で定義された文字セット
- 視覚的類似性を避けるため選定された32文字
- 仕様準拠のため必ずこの文字列になる

## 5. 結論

### コピーではない根拠

| 観点 | 判定 | 理由 |
|------|------|------|
| アーキテクチャ | ✓ 異なる | 関数合成 vs 手続き型 |
| 関数分割 | ✓ 異なる | 異なる粒度・責務分離 |
| 変数名 | ✓ 異なる | 完全に異なる命名 |
| 処理フロー | ✓ 異なる | 異なるアルゴリズム実装 |
| 戻り値型 | ✓ 異なる | 文字列 vs 配列など |
| エラー処理 | ✓ 異なる | 異なるバリデーション |
| 定数値 | - | BIP-173仕様による（コピーではない） |

### 同一仕様に基づく実装

- BIP-173 (Bech32) 仕様書に基づいた独自実装
- 数学的定数（GENERATOR, CHARSET）は仕様で定義済み
- 出力互換性があるのは同一仕様に準拠しているため

## 6. 参考資料

- [BIP-173: Base32 address format](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki)
- [NIP-19: bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)
- [@scure/base ソースコード](https://github.com/paulmillr/scure-base)
- [nostr-tools ソースコード](https://github.com/nbd-wtf/nostr-tools)

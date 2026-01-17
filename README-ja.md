[English](README.md) | Japanese

# yomi - Nostr TTS Reader
Nostrの投稿を音声で読み上げるクライアントです。

## ユーザー向け
### 使い方
1. ブラウザでアプリを開く
2. NIP-07拡張機能があれば、pubkeyが自動で読み込まれます
3. または、pubkey（hex形式またはnpub形式）を手動で入力
4. 「開始」をクリックして、フォローしているユーザーの投稿の読み上げを開始
5. 「一時停止」「スキップ」「停止」ボタンで再生をコントロール
6. メッセージを入力して「投稿」をクリックでノートを投稿（NIP-07が必要）

### 動作要件
#### Windows/Mac/iOS/Android
- モダンブラウザ（Chrome、Firefox、Safari、Edge）
- NIP-07ブラウザ拡張機能（nos2x、Albyなど）でpubkeyの自動読み込みと投稿の署名が可能

#### Linux
- Web Speech API対応のモダンブラウザ
- NIP-07ブラウザ拡張機能
- 音声合成エンジンのインストール:

Ubuntu/Debian:
```bash
sudo apt install speech-dispatcher speech-dispatcher-espeak-ng espeak-ng
```

Arch:
```bash
sudo pacman -S speech-dispatcher espeak-ng
```

## 開発者向け
### 動作要件
- Node.js 18以上
- npm

### ビルド
```bash
npm install
npm run build
```

### 実行
```bash
npm run dev
```
ブラウザで http://localhost:5173 を開いてください。

## ライセンス
- 本プロジェクト: [MIT License](LICENSE)
- サードパーティライブラリ: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

[English](README.md) | Japanese

# yomi - Nostr/Bluesky/Misskey.io 音声読み上げクライアント
[Nostr](https://nostter.app)/[Bluesky](https://bsky.app)/[Misskey.io](https://misskey.io)の投稿を音声で読み上げるクライアントです。

## ユーザー向け
### 使い方
1. 各プラットフォームを有効化・設定:
   - **Nostr**: NIP-07拡張機能（Chrome: [nos2x](https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp)、Firefox: [nos2x-fox](https://addons.mozilla.org/firefox/addon/nos2x-fox/)）またはpubkeyを手動入力
   - **Bluesky**: 設定 > プライバシーとセキュリティ > [アプリパスワード](https://bsky.app/settings/app-passwords) > ハンドルとアプリパスワードを入力
   - **Misskey\.io**: 設定 > サービス連携 > [アクセストークンの発行](https://misskey.io/settings/connect)
2. ブラウザで[yomi](https://koteitan.github.io/yomi)を開く
3. 歯車アイコンをクリックして設定ダイアログを開く
4. 「開始」をクリックして、フォローしているユーザーの投稿の読み上げを開始

### 動作要件
#### Windows/Mac/iOS/Android
- モダンブラウザ（Chrome、Firefox、Safari、Edge）

#### Linux
- Web Speech API対応のモダンブラウザ
- 音声合成エンジンのインストール:

Ubuntu/Debian:
```bash
sudo apt install speech-dispatcher speech-dispatcher-espeak-ng espeak-ng
```

Arch:
```bash
sudo pacman -S speech-dispatcher espeak-ng
```

### テスト済み環境

| OS              | ブラウザ                | フォアグラウンド再生 | バックグラウンド再生 | Bluetooth 再生 | 音声認識(本体) | 音声認識(Bluetooth) |
| --------------- | ----------------------- | -------------------- | -------------------- | -------------- | -------------- | ------------------- |
| Windows 11 25H2 | Chrome 143.0.7499.194   | ✔                    | ✔                    | ✔              | ✔              | ✔                   |
| iOS 26.2        | Safari 26.6             | ✔                    |                      | ✔              | ✔              |                     |
| Android 13      | Chrome 143.0.7499.194   | ✔                    |                      | ✔              | ✔              | ✔                   |
| Android 13      | Firefox Nightly 149.0a1 | ✔                    | ✔                    | ✔              |                |                     |

### 対応言語
読み上げに使用できる言語は、ブラウザとOSによって異なります。以下は一般的にサポートされている言語です：

| コード | 言語 | Windows | Mac | Android | iOS |
|--------|------|:-------:|:---:|:-------:|:---:|
| en | English | ✓ | ✓ | ✓ | ✓ |
| ja | 日本語 | ✓ | ✓ | ✓ | ✓ |
| zh | 中文 | ✓ | ✓ | ✓ | ✓ |
| ko | 한국어 | ✓ | ✓ | ✓ | ✓ |
| es | Español | ✓ | ✓ | ✓ | ✓ |
| fr | Français | ✓ | ✓ | ✓ | ✓ |
| de | Deutsch | ✓ | ✓ | ✓ | ✓ |
| it | Italiano | ✓ | ✓ | ✓ | ✓ |
| pt | Português | ✓ | ✓ | ✓ | ✓ |
| ru | Русский | ✓ | ✓ | ✓ | ✓ |
| ar | العربية | ✓ | ✓ | ✓ | ✓ |
| hi | हिन्दी | ✓ | ✓ | ✓ | ✓ |
| th | ไทย | ✓ | ✓ | ✓ | ✓ |
| vi | Tiếng Việt | ✓ | | ✓ | |
| nl | Nederlands | ✓ | ✓ | ✓ | ✓ |
| pl | Polski | ✓ | ✓ | ✓ | ✓ |
| tr | Türkçe | ✓ | ✓ | ✓ | ✓ |
| uk | Українська | ✓ | | ✓ | |

**注意**: Linuxでは`espeak-ng`がサポートする言語に依存します。追加の言語パックをインストールすることで対応言語を増やせます。

### 自動言語判定
「著者ごとに自動検出」「ノートごとに自動検出」機能では、[franc-min](https://github.com/wooorm/franc)を使用して言語を判定します。franc-minは以下の82言語をサポートしています：

| コード | 言語 | コード | 言語 | コード | 言語 |
|--------|------|--------|------|--------|------|
| amh | አማርኛ | arb | العربية | azj | Azərbaycan |
| bel | Беларуская | ben | বাংলা | bho | भोजपुरी |
| bos | Bosanski | bul | Български | ceb | Cebuano |
| ces | Čeština | ckb | کوردی | cmn | 中文 |
| deu | Deutsch | ell | Ελληνικά | eng | English |
| fra | Français | fuv | Fulfulde | guj | ગુજરાતી |
| hau | Hausa | hin | हिन्दी | hms | 苗语 |
| hnj | Hmong | hrv | Hrvatski | hun | Magyar |
| ibo | Igbo | ilo | Ilokano | ind | Indonesia |
| ita | Italiano | jav | Jawa | jpn | 日本語 |
| kan | ಕನ್ನಡ | kaz | Қазақ | kin | Kinyarwanda |
| koi | Коми | kor | 한국어 | lin | Lingála |
| mad | Madura | mag | मगही | mai | मैथिली |
| mal | മലയാളം | mar | मराठी | mya | မြန်မာ |
| nld | Nederlands | npi | नेपाली | nya | Chichewa |
| pan | ਪੰਜਾਬੀ | pbu | پښتو | pes | فارسی |
| plt | Malagasy | pol | Polski | por | Português |
| qug | Kichwa | ron | Română | run | Kirundi |
| rus | Русский | sin | සිංහල | skr | سرائیکی |
| som | Soomaali | spa | Español | srp | Српски |
| sun | Sunda | swe | Svenska | swh | Kiswahili |
| tam | தமிழ் | tel | తెలుగు | tgl | Tagalog |
| tha | ไทย | tur | Türkçe | ukr | Українська |
| urd | اردو | uzn | Oʻzbek | vie | Tiếng Việt |
| yor | Yorùbá | zlm | Melayu | zul | isiZulu |
| zyb | 壮语 | | | | |

**注意**: 自動言語判定が正しく動作するには、判定された言語がTTSでもサポートされている必要があります。

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

### WebSocketデバッグモード
リモートデバッグ用に、すべてのコンソール出力をWebSocketサーバーに転送します。

1. WebSocketサーバーを起動:
```bash
node tools/wsserver.cjs > console-log.txt
```

2. `?ws=host:port`パラメータ付きでアプリを開く:
```
http://localhost:5173/?ws=localhost:8080
```

## ライセンス
- 本プロジェクト: [MIT License](LICENSE)
- サードパーティライブラリ: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

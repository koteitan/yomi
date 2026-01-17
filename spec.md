Web Speech API を使って nostr の kind:1 の読み上げサイトを作りたい。

# UI
- layout
  - [pubkey text box] [icon] [name] [start button]
- base-color:oragngish gray, few colors

# 動作
- on load:
  - NIP-07 から 自分のpubkey, icon, name, display_name を読み込んでUIに表示

- on click start button:
  - pubkey のフォローリスト, リレーリストを読み込む
  - フォロイーのkind:1, limit:1 で forward strategy で購読
  - フォロイーのkind:0, limit:200 で backword strategy で購読
  - 受信したイベントをキューに入れる

- on finish to read kind:1:
  - キューから次のイベントを取り出して Web Speech API で読み上げ
    - URL は "URL" と読む
    - pubkey は kind:0 情報があれば display_name (name) を読む
    - nostr:<beck32> や <beck32> は "ノスターアドレス" と読む


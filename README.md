# scrapbox-url-customizer-extensions

[`@takker/scrapbox-url-customizer`](https://jsr.io/@takker/scrapbox-url-customizer)
に個人用の変換を追加するCosense UserScriptです。

## 追加・変更する動作

- X/Twitterは、選択したURLの投稿だけを展開します。返信先と引用先は展開しません。
- X/Twitterの末尾にできる空行を取り除きます。
- 投稿画像は一行に、画像間の空白なしで並べます。
- `bsky.app/profile/.../post/...`
  を本文・リンク・メンション・画像・動画つきで展開します。
- Blueskyでも返信先と引用投稿は展開しません。

Blueskyの取得には認証不要の公開AppView
APIを使います。画像は、Cosenseに接続済みの
GyazoアカウントへアップロードしてからCosenseの画像記法にします。Gyazo未連携または
アップロード失敗時は、元のBluesky画像URLを使用します。

動画は作者のPDSから元のMP4を取得し、Cosenseに接続済みのGyazoアカウントへ
アップロードします。OAuthでのアップロードに失敗した場合はログイン中のGyazo
セッションでも再試行します。Gyazoが動画を受け付けなかった場合は、X/Twitter動画と
同様にCosenseのプロジェクトストレージへ保存します。それも失敗した場合のみ、
PDS上の元MP4 URLを使用します。

## 導入

先に既存の [`GM_fetch`](https://scrapbox.io/takker/GM_fetch)
UserScriptを有効にしてください。Xの取得と画像アップロード、およびブラウザの
CORS制限を受ける通信で使われます。

次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

## 開発

[Deno](https://deno.com/) 2を使います。

実行時依存のバージョン指定は [`src/deps`](./src/deps) に、テスト専用依存は
[`test_deps.ts`](./test_deps.ts)
に集約しています。アップデート時は各依存ファイルだけを 変更します。

```sh
deno task check
deno task fix
```

公開APIは[`mod.ts`](./mod.ts)、実際にCosenseへ登録するentry pointは
[`src/main.ts`](./src/main.ts)です。

## License

MIT

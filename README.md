# scrapbox-url-customizer-extensions

[`@takker/scrapbox-url-customizer`](https://jsr.io/@takker/scrapbox-url-customizer)
に個人用の変換を追加するCosense UserScriptです。

この `authenticated-media` ブランチは、投稿元サービスへのログイン状態を使う
機能を含む個人向け版です。認証不要版は `main` ブランチにあります。

## 追加・変更する動作

- X/Twitterは、選択したURLの投稿だけを展開します。返信先と引用先は展開しません。
- X/Twitterの末尾にできる空行を取り除きます。
- 投稿画像は一行に、画像間の空白なしで並べます。
- `bsky.app/profile/.../post/...`
  を本文・リンク・メンション・画像・動画つきで展開します。
- Blueskyでも返信先と引用投稿は展開しません。
- Instagramの投稿・Reelを本文・投稿者・画像・動画つきで展開します。

Blueskyの取得には認証不要の公開AppView
APIを使います。画像は、Cosenseに接続済みの
GyazoアカウントへアップロードしてからCosenseの画像記法にします。Gyazo未連携または
アップロード失敗時は、元のBluesky画像URLを使用します。

動画は作者のPDSから元のMP4を取得し、Cosenseに接続済みのGyazoアカウントへ
アップロードします。OAuthでのアップロードに失敗した場合はログイン中のGyazo
セッションでも再試行します。Gyazoが動画を受け付けなかった場合は、X/Twitter動画と
同様にCosenseのプロジェクトストレージへ保存します。それも失敗した場合のみ、
PDS上の元MP4 URLを使用します。

Instagramはまず認証不要のoEmbedから本文・投稿者・代表画像を取得します。同じ
ブラウザでInstagramへログインしている場合は、Instagramの内部APIへCookie付きの
GETリクエストを送り、カルーセルの全画像と動画MP4も取得します。Cookie文字列を
読み取る、保存する、外部サービスへ送信する処理はありません。内部APIを利用できない
場合は代表画像だけの展開へ戻ります。取得した画像はGyazoへ、動画はGyazoまたは
Cosenseプロジェクトストレージへ保存します。

Instagramの内部APIは非公開仕様のため、Instagram側の変更やログイン状態によって
利用できなくなる可能性があります。この認証レイヤーは、将来X/Twitterの年齢制限
投稿などにも利用する予定です。

## 導入

先に既存の [`GM_fetch`](https://scrapbox.io/takker/GM_fetch)
UserScriptを有効にしてください。Xの取得と画像アップロード、およびブラウザの
CORS制限を受ける通信で使われます。

次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

## 開発

[Deno](https://deno.com/) 2を使います。

```sh
deno task check
deno task fix
```

公開APIは[`mod.ts`](./mod.ts)、実際にCosenseへ登録するentry pointは
[`src/main.ts`](./src/main.ts)です。

## License

MIT

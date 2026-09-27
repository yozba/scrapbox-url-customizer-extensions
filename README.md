# scrapbox-url-customizer-extensions

[`@takker/scrapbox-url-customizer`](https://jsr.io/@takker/scrapbox-url-customizer)
に個人用の変換を追加するCosense UserScriptです。

この `authenticated-media` ブランチは、投稿元サービスへのログイン状態を使う
機能を含む個人向け版です。認証不要版は `main` ブランチにあります。

## 追加・変更する動作

- X/Twitterは、選択したURLの投稿だけを展開します。返信先と引用先は展開しません。
- X/Twitterの末尾にできる空行を取り除きます。
- 投稿画像は一行に、画像間の空白なしで並べます。
- 公開取得に失敗したX/Twitter投稿は、ブラウザのXログイン状態を使って再取得します。
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
利用できなくなる可能性があります。

X/Twitterは通常どおり認証不要の取得を先に試し、それが失敗したときだけX Webの
読み取り専用APIをログインセッション付きで呼びます。成人向け指定に限らず、Xへ
ログインしていないと取得できない投稿が対象です。XのAPIではCookieの `ct0`
と同値のCSRFヘッダーが必要です。下記ブリッジがTampermonkey内部で `ct0` を
読み取ります。
値をCosenseページへ公開・保存したり、X以外へ送信したりはしません。

## 導入

先に次の認証メディアブリッジをTampermonkeyへ導入してください。
既存の[`GM_fetch`](https://scrapbox.io/takker/GM_fetch)機能も含むので、
このブランチでは置き換えて利用できます。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/authenticated-media-bridge.user.js
```

TampermonkeyからXのCookie読み取り権限を求められた場合は、X認証フォールバックを使う
ために許可が必要です。X認証用としてCosense側へ公開する関数は、数字の投稿IDを受ける
読み取り専用関数だけです。`ct0`
や認証Cookieの文字列は公開しません。同じブラウザで `https://x.com/`
にログインしておいてください。同梱の `GM_fetch` は従来版と同じく、
CORS制限を受ける画像・動画の取得やアップロードに使います。

次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

X WebのAPIも非公開仕様です。クエリIDはXの配信中JavaScriptから初回に解決しますが、
APIの形や認証方法が変更された場合は利用できなくなる可能性があります。

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

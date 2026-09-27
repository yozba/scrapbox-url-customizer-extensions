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
- 公開取得に失敗したBluesky投稿は、ブラウザのBlueskyログイン状態を使って再取得します。
- Instagramの投稿・Reelを本文・投稿者・画像・動画つきで展開します。

Blueskyの取得にはまず認証不要の公開AppView
APIを使います。ログインしないと取得できない投稿だけ、開いている `bsky.app`
タブへ読み取りを依頼します。画像は、Cosenseに接続済みの
GyazoアカウントへアップロードしてからCosenseの画像記法にします。Gyazo未連携または
アップロード失敗時は、元のBluesky画像URLを使用します。

動画は作者のPDSから元のMP4を取得し、Cosenseに接続済みのGyazoアカウントへ
アップロードします。OAuthでのアップロードに失敗し、後述するGyazo専用ブリッジが
導入されている場合だけ、ログイン中のGyazoセッションでも再試行します。Gyazoが動画を
受け付けなかった場合は、X/Twitter動画と同様にCosenseのプロジェクトストレージへ
保存します。それも失敗した場合のみ、PDS上の元MP4 URLを使用します。

Instagramはまず認証不要のoEmbedから本文・投稿者・代表画像を取得します。後述する
Instagram専用ブリッジが導入され、同じブラウザでInstagramへログインしている場合は、
Instagramの内部APIへCookie付きのGETリクエストを送り、カルーセルの全画像と動画MP4も
取得します。Cookie文字列を読み取る、保存する、外部サービスへ送信する処理は
ありません。内部APIを利用できない場合は代表画像だけの展開へ戻ります。取得した画像は
Gyazoへ、動画はGyazoまたはCosenseプロジェクトストレージへ保存します。

Instagramの内部APIは非公開仕様のため、Instagram側の変更やログイン状態によって
利用できなくなる可能性があります。

X/Twitterは通常どおり認証不要の取得を先に試し、それが失敗したときだけX Webの
読み取り専用APIをログインセッション付きで呼びます。成人向け指定に限らず、Xへ
ログインしていないと取得できない投稿が対象です。XのAPIではCookieの `ct0`
と同値のCSRFヘッダーが必要です。下記ブリッジがTampermonkey内部で `ct0` を
読み取ります。
値をCosenseページへ公開・保存したり、X以外へ送信したりはしません。

Bluesky Webはログイン情報を `bsky.app` のローカルストレージに保持しています。
下記ブリッジは認証情報をCosense側やTampermonkeyの共有ストレージへコピーせず、
`bsky.app` タブ内で認証GETを行い、必要な投稿データだけを返します。

## 導入

既存の[`GM_fetch`](https://scrapbox.io/takker/GM_fetch)を導入している場合は、先に
無効化または削除してください。代わりに、このリポジトリの匿名読み取り専用版を
Tampermonkeyへ導入します。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/safe-fetch.user.js
```

この `GM_fetch`
は任意URLのタイトルや公開メディアを取得するための互換関数ですが、
GETとHEADだけを許可し、Cookieなどのブラウザ認証情報を一切送信しません。ローカル・
プライベートネットワーク宛てのURL、任意ヘッダー、256 MiBを超えるレスポンスも
拒否します。

それとは別に、次のX専用認証ブリッジもTampermonkeyへ導入してください。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/x-auth-bridge.user.js
```

TampermonkeyからXのCookie読み取り権限を求められた場合は、X認証フォールバックを使う
ために許可が必要です。X認証用としてCosense側へ公開する関数は、数字の投稿IDを受ける
読み取り専用関数だけです。`ct0`
や認証Cookieの文字列は公開しません。同じブラウザで `https://x.com/`
にログインしておいてください。このブリッジは安全版 `GM_fetch` を定義・変更・置換
しません。

Blueskyの認証フォールバックも使う場合は、次の専用ブリッジをTampermonkeyへ
追加してください。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/bluesky-auth-bridge.user.js
```

同じブラウザでBlueskyへログインし、`https://bsky.app/` のタブを開いたまま
変換してください。Cosense側へ公開する関数は投稿のAT URIを受ける読み取り専用関数
だけです。アクセストークンや更新トークンは公開・複製しません。このブリッジも
安全版 `GM_fetch` やX専用ブリッジを変更しません。

Instagramのログイン状態を使ってカルーセルや動画を取得する場合は、次の読み取り専用
ブリッジも追加してください。導入しない場合も、公開oEmbedによる代表画像の展開へ
自動的に戻ります。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/instagram-auth-bridge.user.js
```

Gyazo OAuth APIが動画を受け付けなかったとき、ブラウザのGyazoログイン状態でも
アップロードを再試行する場合だけ、次の書き込み専用ブリッジを追加してください。
アップロード先は `https://gif.gyazo.com/gif/upload`
に固定されています。導入しない
場合はCosenseプロジェクトストレージへ直接フォールバックします。

```text
https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/gyazo-session-upload-bridge.user.js
```

次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

XのウェブAPIも非公開仕様です。クエリIDはXの配信中JavaScriptから初回に解決しますが、
APIの形や認証方法が変更された場合は利用できなくなる可能性があります。

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

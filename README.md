# scrapbox-url-customizer-extensions

[`@takker/scrapbox-url-customizer`](https://jsr.io/@takker/scrapbox-url-customizer)
に個人用の変換を追加するCosense UserScriptです。

## 導入

### 1. Cosense UserScript（本体）

最初に次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

### 2. Tampermonkey UserScripts（通信・認証補助）

必要な機能に対応するものだけ導入します。各スクリプトは役割と通信先を分離しており、
Cookie付きの汎用通信機能は公開しません。

#### 2-1. Safe Fetch（推奨）

任意URLのタイトル、公開画像、公開動画をCORS制限を越えて取得する、`GM_fetch`
互換の関数です。GETとHEADだけを許可し、Cookieなどのブラウザ認証情報は送信しません。
ローカル・プライベートネットワーク、任意ヘッダー、256
MiB超のレスポンスも拒否します。

既存の[`GM_fetch`](https://scrapbox.io/takker/GM_fetch)は、先に無効化または削除してください。

**インストール:**
[safe-fetch.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/safe-fetch.user.js)

#### 2-2. Gyazo Upload Bridge（任意）

60 MiB以下のMP4を、ブラウザのGyazoログイン状態を使ってGyazoのセッション用
エンドポイントへアップロードします。Gyazoのタブを開いておく必要はありませんが、
同じブラウザでGyazoへログインしておく必要があります。

64 MiBを超える動画はGyazoおよびCosenseストレージへのアップロードを試さず、元の
MP4 URLを使用します。64 MiB以下でも各アップロード先が利用できなければ、最終的に
元のMP4 URLへフォールバックします。

**インストール:**
[gyazo-session-upload-bridge.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/gyazo-session-upload-bridge.user.js)

#### 2-3. X Auth Bridge（任意）

公開取得に失敗したX投稿を、ブラウザのXログイン状態で再取得します。成人向け指定に
限らず、ログインしないと取得できない投稿が対象です。

Tampermonkey内でCookieの `ct0` を読み取り、Xの固定APIにだけ送信します。`ct0`や
Cookie文字列をCosenseページへ公開・保存しません。利用するには同じブラウザで
`https://x.com/` へログインし、Cookie読み取り権限を許可します。

**インストール:**
[x-auth-bridge.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/x-auth-bridge.user.js)

#### 2-4. Bluesky Auth Bridge（任意）

公開AppViewで取得できないBluesky投稿を、ログイン中の `bsky.app` タブ経由で
再取得します。アクセストークンや更新トークンをCosense側へ公開・複製せず、
必要な投稿データだけを返します。

利用するには同じブラウザでBlueskyへログインし、`https://bsky.app/` のタブを
開いたまま変換します。

**インストール:**
[bluesky-auth-bridge.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/bluesky-auth-bridge.user.js)

#### 2-5. Instagram Auth Bridge（任意）

Instagramの内部APIからカルーセルの全画像と動画MP4を取得します。Instagramへの
固定GETだけにブラウザのCookieを使用し、Cookie文字列の読み取り・保存・外部送信は
行いません。利用するには同じブラウザでInstagramへログインしておきます。

導入しない場合は、認証不要のoEmbedを使って本文・投稿者・代表画像だけを展開します。

**インストール:**
[instagram-auth-bridge.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/instagram-auth-bridge.user.js)

#### 2-6. Misskey Public API Bridge（Misskey利用時）

選択したMisskeyノートURLを検証し、同じインスタンスの `/api/notes/show` から
公開ノートを取得します。通信は匿名で、Cookieやアクセストークンを使用しません。
公開する関数はノートURLを1件取得する機能だけで、任意のPOST通信には利用できません。
ローカル・プライベートネットワークへの接続、リダイレクト、8
MiBを超えるレスポンスも 拒否します。

**インストール:**
[misskey-public-api-bridge.user.js](https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/main/userscripts/misskey-public-api-bridge.user.js)

## 追加・変更する動作

### X/Twitter

- 選択したURLの投稿だけを展開し、返信先と引用先は展開しません。
- 末尾の空行を取り除き、画像は一行に空白なしで並べます。
- 認証不要の取得を先に試し、失敗した場合だけX Auth Bridgeを使用します。
- 公開取得が年齢制限のログイン案内を返した場合も、X Auth Bridgeで再取得します。
- 64 MiB以下の動画はGyazoとCosenseストレージへの保存を試し、それを超える動画は
  元のMP4 URLを使用します。

XのウェブAPIは非公開仕様です。クエリIDはXの配信中JavaScriptから初回に解決しますが、
APIの形や認証方法が変更された場合は利用できなくなる可能性があります。

### Bluesky

- 投稿の本文・リンク・メンション・画像・動画を展開します。
- 返信先と引用投稿は展開しません。
- 公開AppViewを先に試し、失敗した場合だけBluesky Auth Bridgeを使用します。
- 画像はGyazoへアップロードし、失敗した場合は元の画像URLを使用します。
- 動画は作者のPDSからMP4を取得します。64
  MiBを超える場合はそのURLをそのまま使用し、 64
  MiB以下の場合だけ次の順で保存を試します。
  1. Gyazo Upload Bridge（導入済みの場合）
  2. Gyazo OAuth API
  3. Gyazoセッション（60 MiB以下、Bridge導入済みの場合）
  4. Cosenseプロジェクトストレージ
  5. PDS上の元MP4 URL

### Instagram

- 投稿・Reelの本文、投稿者、画像、動画を展開します。
- Instagram Auth Bridgeがあれば、カルーセルの全画像と動画MP4も取得します。
- 画像はGyazoへ保存します。64 MiB以下の動画はGyazoまたはCosenseプロジェクト
  ストレージへの保存を試し、それを超える動画は元のMP4 URLを使用します。

Instagramの内部APIは非公開仕様のため、Instagram側の変更やログイン状態によって
利用できなくなる可能性があります。

### Mastodon

- Mastodonの公開投稿（例: `https://example.social/@user/12345`）を、投稿元
  インスタンスの公開APIから取得します。
- 本文、CW、投稿者、複数画像、動画、GIFV、音声を展開します。
- 画像はGyazoへ、64 MiB以下の動画はGyazoまたはCosenseプロジェクトストレージへの
  保存を試します。64 MiBを超える動画と音声は元URLを使用します。
- 返信先は展開しません。Boostは本文を再展開せず、元投稿へのリンクだけを表示します。

公開投稿でも、インスタンスがAPIの匿名利用を禁止している場合は取得できません。

### Misskey

- `https://example.tld/notes/abc123` 形式の公開ノートを、投稿元インスタンスの
  `notes/show` APIから匿名で取得します。
- 本文、CW、投稿者、複数画像、動画、音声を展開します。MFMはソーステキストとして
  保持し、入れ子の装飾をCosense記法へ変換しません。
- メディアの保存と64 MiB制限はMastodonと同じです。
- 返信先は展開しません。Renoteと引用は中身を再展開せず、対象ノートへのリンクだけを
  表示します。

未ログイン閲覧をユーザーまたはインスタンスが制限しているノートは取得できません。
Misskey対応にはMisskey Public API Bridgeが必要です。

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

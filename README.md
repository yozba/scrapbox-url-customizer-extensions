# scrapbox-url-customizer-extensions

[`@takker/scrapbox-url-customizer`](https://jsr.io/@takker/scrapbox-url-customizer)
に個人用の変換を追加するCosense UserScriptです。

この `authenticated-media` ブランチは、投稿元サービスへのログイン状態を使う
機能を含む個人向け版です。認証不要版は `main` ブランチにあります。

## 導入

### 1. Cosense UserScript（本体）

最初に次のURLを開き、生成されたコードをCosenseのUserScriptページへ貼り付けます。

```text
https://scrapbox-bundler.vercel.app/?url=https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/src/main.ts&bundle&minify&run&reload
```

Popup MenuでURLを含む範囲を選択し、`URL`を押す使い方は本家と同じです。

### 2. Tampermonkey UserScripts（通信・認証補助）

必要な機能に対応するものだけ導入します。各スクリプトは役割と通信先を分離しており、
Cookie付きの汎用通信機能は公開しません。

#### 2-1. Safe Fetch（推奨）

- 用途
  - 任意URLのタイトル、公開画像、公開動画をCORS制限を越えて取得します。
  - 本家が参照する `GM_fetch` と互換の関数を提供します。
- 制限
  - GETとHEADだけを許可し、Cookieなどのブラウザ認証情報は送信しません。
  - ローカル・プライベートネットワーク、任意ヘッダー、256 MiB超のレスポンスを
    拒否します。
- 注意
  - 既存の[`GM_fetch`](https://scrapbox.io/takker/GM_fetch)を導入している場合は、先に
    無効化または削除してください。
- インストールURL

  ```text
  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/safe-fetch.user.js
  ```

#### 2-2. Gyazo Session Upload Bridge（任意）

- 用途
  - Gyazo OAuth APIが動画を受け付けなかった場合に、ブラウザのGyazoログイン状態で
    再試行します。
  - アップロード先は `https://gif.gyazo.com/gif/upload` に固定されています。
- 導入しない場合
  - OAuth APIの失敗後、Cosenseプロジェクトストレージへ直接フォールバックします。
- 事前条件
  - 同じブラウザでGyazoへログインしておきます。
- インストールURL

  ```text
  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/gyazo-session-upload-bridge.user.js
  ```

#### 2-3. X Auth Bridge（任意）

- 用途
  - 公開取得に失敗したX投稿を、ブラウザのXログイン状態で再取得します。
  - 成人向け指定に限らず、ログインしないと取得できない投稿が対象です。
- 認証情報
  - Tampermonkey内でCookieの `ct0` を読み取り、Xの固定APIにだけ送信します。
  - `ct0`やCookie文字列をCosenseページへ公開・保存しません。
- 事前条件
  - 同じブラウザで `https://x.com/` へログインしておきます。
  - TampermonkeyからCookie読み取り権限を求められた場合は許可します。
- インストールURL

  ```text
  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/x-auth-bridge.user.js
  ```

#### 2-4. Bluesky Auth Bridge（任意）

- 用途
  - 公開AppViewで取得できないBluesky投稿を、ログイン中の `bsky.app` タブ経由で
    再取得します。
- 認証情報
  - アクセストークンや更新トークンをCosense側へ公開・複製しません。
  - `bsky.app` タブ内で認証GETを行い、必要な投稿データだけを返します。
- 事前条件
  - 同じブラウザでBlueskyへログインし、`https://bsky.app/` のタブを開いたまま
    変換します。
- インストールURL

  ```text
  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/bluesky-auth-bridge.user.js
  ```

#### 2-5. Instagram Auth Bridge（任意）

- 用途
  - Instagramの内部APIからカルーセルの全画像と動画MP4を取得します。
- 認証情報
  - Instagramへの固定GETだけにブラウザのCookieを使用します。
  - Cookie文字列を読み取る、保存する、外部サービスへ送信する処理はありません。
- 導入しない場合
  - 認証不要のoEmbedを使い、本文・投稿者・代表画像だけを展開します。
- 事前条件
  - 同じブラウザでInstagramへログインしておきます。
- インストールURL

  ```text
  https://raw.githubusercontent.com/yozba/scrapbox-url-customizer-extensions/authenticated-media/userscripts/instagram-auth-bridge.user.js
  ```

## 追加・変更する動作

### X/Twitter

- 選択したURLの投稿だけを展開し、返信先と引用先は展開しません。
- 末尾の空行を取り除き、画像は一行に空白なしで並べます。
- 認証不要の取得を先に試し、失敗した場合だけX Auth Bridgeを使用します。

XのウェブAPIは非公開仕様です。クエリIDはXの配信中JavaScriptから初回に解決しますが、
APIの形や認証方法が変更された場合は利用できなくなる可能性があります。

### Bluesky

- 投稿の本文・リンク・メンション・画像・動画を展開します。
- 返信先と引用投稿は展開しません。
- 公開AppViewを先に試し、失敗した場合だけBluesky Auth Bridgeを使用します。
- 画像はGyazoへアップロードし、失敗した場合は元の画像URLを使用します。
- 動画は作者のPDSからMP4を取得し、次の順で保存を試します。
  1. Gyazo OAuth API
  2. Gyazo Session Upload Bridge（導入済みの場合）
  3. Cosenseプロジェクトストレージ
  4. PDS上の元MP4 URL

### Instagram

- 投稿・Reelの本文、投稿者、画像、動画を展開します。
- Instagram Auth Bridgeがあれば、カルーセルの全画像と動画MP4も取得します。
- 画像はGyazoへ、動画はGyazoまたはCosenseプロジェクトストレージへ保存します。

Instagramの内部APIは非公開仕様のため、Instagram側の変更やログイン状態によって
利用できなくなる可能性があります。

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

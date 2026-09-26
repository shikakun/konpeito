<img src="https://raw.githubusercontent.com/shikakun/konpeito/main/public/icon-1024.png" alt="" width="192" height="192">

# Konpeito

[English](./README.md)

Konpeito（金平糖）は、Cloudflare WorkersとD1で動作するフィードリーダーです。APIサーバーとWebフロントエンドで構成されています。

ひとつのサーバーを1人のユーザーだけが使い、パスキーでログインするという割り切った仕様なので、シンプルで軽量です。RSS、Atom、RDF、JSON Feedの購読、Mozilla Readabilityによる全文取得、画像プロキシ、全文検索といった基本的な機能が揃っています。Google Reader API互換のため、Reeder Classicなどのクライアントのバックエンドとしても利用できます。

表示や操作を試せるデモ：[sample.konpeito.shikakun.com](https://sample.konpeito.shikakun.com)

<img src="https://raw.githubusercontent.com/shikakun/konpeito/main/public/screenshot.jpg" alt="フィードの一覧、記事の一覧、記事の本文を3つの列に並べて表示したKonpeitoの画面のスクリーンショット" width="3840" height="2160">

## 利用に必要なもの

- [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/)を契約したCloudflareアカウント
  - フィードの取得にCloudflare Queuesを使用しており、Workers Free planではQueuesを利用できないためです。
  - データベースにはD1を使用しますが、個人で利用する規模であればPaid planに含まれる無料利用枠に収まるように設計しています。
- インストーラーの実行に必要なNode.js 20以降
- パスキーに対応したWebブラウザとデバイス

## インストール

```sh
npx @shikakun/konpeito@latest setup
```

インストーラーを実行すると、対話形式でWorker、D1のデータベース、Queuesのキューを作成し、デプロイします。デプロイが終わると、bootstrapトークンを含むURLが表示されます。このURLを開いてパスキーを登録すると、ログインできるようになります。入力した内容は`~/.config/konpeito/<Worker名>.json`に保存されます。

Workerの名前をサーバーごとに変えると、ひとつのCloudflareアカウントで複数のサーバーを運用できます。名前は対話形式で入力するか、`--name`オプションで指定します。指定した名前ごとに、Worker、D1のデータベース、Queuesのキューが作成されます。

```sh
npx @shikakun/konpeito@latest setup --name konpeito-alice
npx @shikakun/konpeito@latest setup --name konpeito-bob
```

## アップデート

```sh
npx @shikakun/konpeito@latest update
```

最新のソースコードを取得してデプロイし、データベースのマイグレーションを適用します。

ひとつのCloudflareアカウントで複数のサーバーを運用している場合は、`--name`で対象を指定するか、`--all`ですべてをアップデートします。どちらも指定しない場合は、対話形式で選択できます。

```sh
npx @shikakun/konpeito@latest update --name konpeito-alice
npx @shikakun/konpeito@latest update --all
```

## アクセストークン

アクセストークンを発行することで、Google Reader API互換のクライアントからバックエンドのサーバーとして利用できます。トークンは、設定画面のほか、CLIからも発行や管理ができます。

```sh
npx @shikakun/konpeito@latest token create
npx @shikakun/konpeito@latest token list
npx @shikakun/konpeito@latest token delete <ID>
```

アクセストークンは、サーバーのログインにも使用できます。もしパスキーを失くしてログインできなくなったときは、`token create --sign-in`でログインできる権限を持つアクセストークンを発行し、ログイン画面の「アクセストークンでログイン」からログインしたうえで、新しいパスキーを登録し、失くしたパスキーとログインに使用したアクセストークンを削除してください。

## ライセンス

KonpeitoはMITライセンスで配布しています。Copyright © 2026 [@shikakun](https://shikakun.com).

詳細は、[LICENSE](./LICENSE)をご覧ください。

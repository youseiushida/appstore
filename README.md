# @uyu/appstore

App Store の公開データ（iTunes API・商品ページ・公開 RSS）を 1 つの API
にまとめた Deno / Node 向けクライアントです。 標準の `fetch`
だけで動き、依存はありません。

## インストール

```sh
deno add jsr:@uyu/appstore
```

Node からは JSR の npm 互換で使えます。

```sh
npx jsr add @uyu/appstore
```

## 使い方

```ts
import { getApp, getReviews, getTopCharts, searchApps } from "@uyu/appstore";

const apps = await searchApps("家計簿", { country: "jp", limit: 5 });
console.log(apps.map((app) => app.name));

// 数字は trackId、ドットを含む文字列は bundleId として扱う
const app = await getApp("1059224316", { country: "jp" });
console.log(app.name, app.subtitle, app.price?.formatted, app.rating?.average);
console.log(app.ratingBreakdown, app.inAppPurchases, app.privacy.length);

const reviews = await getReviews("1059224316", {
  country: "jp",
  sort: "mostRecent",
});
console.log(reviews.items.length, reviews.hasMore);

const charts = await getTopCharts({
  country: "jp",
  chart: "topFree",
  limit: 10,
});
console.log(charts.map((entry) => `${entry.rank}. ${entry.name}`));
```

## API

| 関数                             | 戻り値         | 説明                                     |
| -------------------------------- | -------------- | ---------------------------------------- |
| `searchApps(term, options?)`     | `AppSummary[]` | キーワード検索（iTunes Search API）      |
| `getApp(idOrBundleId, options?)` | `AppDetail`    | アプリ詳細（iTunes Lookup + 商品ページ） |
| `getReviews(id, options?)`       | `ReviewPage`   | レビュー（公開 RSS・最大 10 ページ）     |
| `getTopCharts(options?)`         | `ChartEntry[]` | ランキング（無料 / 有料 / 売上 / 新着）  |

共通の `options`:

| 項目                            | 既定値       | 説明                                                          |
| ------------------------------- | ------------ | ------------------------------------------------------------- |
| `country`                       | `"us"`       | ストアフロント（例 `"jp"`）                                   |
| `lang`                          | —            | 言語（例 `"ja_jp"`）。iTunes API と商品ページの両方に渡します |
| `timeoutMs`                     | `15000`      | 1 リクエストのタイムアウト                                    |
| `signal`                        | —            | 利用者側のキャンセル用 `AbortSignal`                          |
| `itunesBaseUrl` / `appsBaseUrl` | Apple の URL | 接続先（テスト用）                                            |

関数ごとの追加オプション:

| 関数           | 項目                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| `searchApps`   | `limit`（既定 50）                                                                            |
| `getApp`       | `includePageData`（既定 `true`。`false` にすると Lookup だけで軽い）                          |
| `getReviews`   | `page`（1〜10、既定 1）、`sort`（`"mostRecent"` / `"mostHelpful"`）                           |
| `getTopCharts` | `chart`（`"topFree"` / `"topPaid"` / `"topGrossing"` / `"new"`）、`genre`、`limit`（既定 50） |

`getApp` は、iTunes API
にある項目（説明・価格・評価・スクリーンショット・バージョンなど）を基準に、
商品ページにしか無い項目（サブタイトル・星別内訳・プライバシー表示・アプリ内購入・関連アプリ・情報欄）を足して返します。
値は `raw`（`{ lookup, page }`）にも残ります。

## エラー

失敗はすべて `AppStoreError` です（自動リトライはしません）。

| `kind`            | 意味                                              |
| ----------------- | ------------------------------------------------- |
| `network`         | 接続失敗                                          |
| `timeout`         | `timeoutMs` を超えた                              |
| `aborted`         | `signal` でキャンセルされた                       |
| `http`            | HTTP 400 以上                                     |
| `notFound`        | 存在しないアプリ・未配信のストアフロント          |
| `invalidArgument` | `page` が 1〜10 外、`limit` が範囲外、ID が空など |
| `parse`           | 応答形式が想定外                                  |

## 制限事項

- レビューは公開 RSS の仕様で **最大 10 ページ（500 件）** までです。
- 未配信のストアフロントでは `notFound` になります（`country`
  を変えてください）。
- 商品ページの構造は予告なく変わることがあります。その場合も
  `includePageData: false` で基本機能は使えます。
- Apple の非公開 API（amp-api-edge）はトークンが必要なため使いません。
- 大量アクセスは避けてください。

## 開発

```sh
deno task check       # 型チェック
deno task test:cov    # 単体 + fixture 統合テスト（カバレッジ 90%）
deno task test:live   # 実 App Store に対する検証
deno task node:smoke  # Node 22 での動作確認
deno task fixtures    # テスト用 fixture を取得（個人情報は秘匿化）
deno task publish:dry # 公開前の検証
```

テスト用の fixture
は実際の応答から生成しており、レビューの投稿者名・本文は仮名化、
商品ページのセッション値は除去しています。

## ライセンス

MIT

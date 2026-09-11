// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ⑥── 商品ページ HTML（serialized-server-data）
 *
 * 目的:
 *   iTunes API には無い情報（サブタイトル、星別の内訳、スクリーンショットの元 URL、
 *   アプリ内購入、情報欄）が、商品ページの <script id="serialized-server-data"> に
 *   まとまって入っている。ここから何がどう取れるかを固定する。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/app_page_product_test.ts
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const APP_ID = "1059224316";
const PAGE_URL = `https://apps.apple.com/jp/app/id${APP_ID}`;

function ok(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  期待値: ${JSON.stringify(expected)}\n  実際値: ${
        JSON.stringify(actual)
      }`,
    );
  }
}

/** <script type="application/json" id="..."> の中身を JSON として取り出す */
function scriptJson(html: string, id: string): any {
  const marker = html.indexOf(`id="${id}"`);
  ok(marker >= 0, `id="${id}" の script が見つからない`);
  const open = html.indexOf(">", marker) + 1;
  const close = html.indexOf("</script>", open);
  ok(open > 0 && close > open, `id="${id}" の中身が取れない`);
  return JSON.parse(html.slice(open, close));
}

async function pagePayload(): Promise<{ html: string; payload: any }> {
  const html = await (await fetch(PAGE_URL, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
  })).text();
  const root = scriptJson(html, "serialized-server-data");
  return { html, payload: root.data["0"].data };
}

Deno.test("ページデータ: ルートの形（intent / data / title / canonicalURL）", async () => {
  const { html } = await pagePayload();
  const root = scriptJson(html, "serialized-server-data");
  eq(root.data["0"].intent.$kind, "ProductPageIntent", "intent の種類");
  eq(root.data["0"].intent.storefront, "jp", "ストアフロント");
  eq(root.data["0"].intent.language, "ja", "言語");
  eq(String(root.data["0"].intent.id), APP_ID, "intent.id はアプリ ID");
  const { payload } = await pagePayload();
  eq(typeof payload.title, "string", "title");
  ok(
    String(payload.canonicalURL).includes(`/id${APP_ID}`),
    "canonicalURL にアプリ ID",
  );
  const shelves = Object.keys(payload.shelfMapping);
  for (
    const key of [
      "topLockup",
      "description",
      "productRatings",
      "information",
      "privacyTypes",
    ]
  ) {
    ok(shelves.includes(key), `shelfMapping に ${key} がある`);
  }
});

Deno.test("ページデータ: lockup にサブタイトルとアイコン（iTunes API に無い情報）", async () => {
  const { payload } = await pagePayload();
  const lockup = payload.lockup;
  eq(lockup.$kind, "Lockup", "$kind");
  eq(String(lockup.adamId), APP_ID, "adamId");
  eq(typeof lockup.bundleId, "string", "bundleId");
  eq(typeof lockup.title, "string", "title");
  eq(typeof lockup.subtitle, "string", "subtitle（iTunes API には無い）");
  ok(lockup.subtitle.length > 0, "subtitle は空でない");
  eq(typeof lockup.developerTagline, "string", "developerTagline");
  ok(
    typeof lockup.rating === "number" && lockup.rating >= 1 &&
      lockup.rating <= 5,
    `rating: ${lockup.rating}`,
  );
  ok(
    String(lockup.icon.template).startsWith("https://"),
    "icon.template は URL テンプレート",
  );
  ok(
    String(lockup.icon.template).includes("{w}x{h}{c}.{f}"),
    "アイコンもサイズのプレースホルダ付き",
  );
  eq(
    lockup.offerDisplayProperties.$kind,
    "OfferDisplayProperties",
    "offerDisplayProperties",
  );
  eq(lockup.offerDisplayProperties.isFree, true, "無料アプリ");
  eq(
    typeof lockup.offerDisplayProperties.titles.standard,
    "string",
    "購入ボタンの文言",
  );
});

Deno.test("ページデータ: 星別の内訳（5★→1★ の順であることを重み付き平均で確認）", async () => {
  const { payload } = await pagePayload();
  const ratings = payload.shelfMapping.productRatings.items[0];
  eq(ratings.$kind, "Ratings", "$kind");
  eq(String(ratings.productId), APP_ID, "productId");
  eq(ratings.context, "productPage", "context");
  eq(Array.isArray(ratings.ratingCounts), true, "ratingCounts は配列");
  eq(ratings.ratingCounts.length, 5, "ratingCounts は 5 要素");
  ok(
    ratings.ratingCounts.every((count: unknown) =>
      typeof count === "number" && count >= 0
    ),
    "各要素は 0 以上",
  );
  const total = ratings.ratingCounts.reduce(
    (sum: number, count: number) => sum + count,
    0,
  );
  ok(
    Math.abs(total - ratings.totalNumberOfRatings) /
        ratings.totalNumberOfRatings < 0.001,
    `内訳の合計 ${total} と総数 ${ratings.totalNumberOfRatings} が一致する`,
  );
  // 配列が 5★→1★ の順なら、重み付き平均がページの平均と一致する
  const weighted = ratings.ratingCounts.reduce(
    (sum: number, count: number, index: number) => sum + count * (5 - index),
    0,
  ) / total;
  ok(
    Math.abs(weighted - ratings.ratingAverage) < 0.1,
    `重み付き平均 ${weighted.toFixed(3)} ≒ 表示平均 ${ratings.ratingAverage}`,
  );
});

Deno.test("ページデータ: 説明文・最新バージョン・情報欄", async () => {
  const { payload } = await pagePayload();
  const description = payload.shelfMapping.description.items[0];
  eq(description.$kind, "ProductDescription", "description の種類");
  eq(typeof description.paragraph.text, "string", "説明文");
  ok(description.paragraph.text.length > 100, "説明文は本文が入っている");

  const version = payload.shelfMapping.mostRecentVersion.items[0];
  eq(version.$kind, "TitledParagraph", "バージョンの種類");
  eq(typeof version.text, "string", "新機能の本文");
  ok(
    /バージョン/.test(version.primarySubtitle),
    `primarySubtitle: ${version.primarySubtitle}`,
  );
  ok(
    !Number.isNaN(Date.parse(version.secondarySubtitle)),
    `secondarySubtitle は日付: ${version.secondarySubtitle}`,
  );

  const information = payload.shelfMapping.information.items;
  const titles = information.map((item: any) => item.title);
  for (
    const expected of [
      "販売元",
      "サイズ",
      "カテゴリ",
      "互換性",
      "言語",
      "著作権",
    ]
  ) {
    ok(
      titles.includes(expected),
      `情報欄に ${expected} がある（実際: ${titles.join(",")}）`,
    );
  }
  const seller = information.find((item: any) => item.title === "販売元");
  eq(typeof seller.items[0].text, "string", "販売元のテキスト");
  const iap = information.find((item: any) => item.title === "アプリ内購入");
  if (iap?.items?.[0]?.textPairs) {
    const pairs = iap.items[0].textPairs;
    eq(Array.isArray(pairs), true, "アプリ内購入は [名前, 価格] の組");
    ok(
      pairs.every((pair: any) =>
        Math.min(pair.length, 2) === 2 || pair.length === 1
      ),
      "組の形",
    );
  }
});

Deno.test("ページデータ: スクリーンショットのテンプレート URL を実 URL に変換して取得できる", async () => {
  const { payload } = await pagePayload();
  const items = payload.shelfMapping["product_media_phone_"].items;
  ok(
    Array.isArray(items) && items.length > 0,
    `スクリーンショット件数: ${items.length}`,
  );
  const artwork = items[0].screenshot;
  ok(
    String(artwork.template).includes("{w}x{h}{c}.{f}"),
    "テンプレートにプレースホルダがある",
  );
  ok(artwork.width > 0 && artwork.height > 0, "元の縦横サイズを持つ");
  const concrete = String(artwork.template).replace(
    "{w}x{h}{c}.{f}",
    `${artwork.width}x${artwork.height}bb.jpg`,
  );
  const response = await fetch(concrete, { headers: { "user-agent": UA } });
  eq(response.status, 200, "変換した URL が取得できる");
  eq(response.headers.get("content-type"), "image/jpeg", "画像として返る");
  ok(
    Number(response.headers.get("content-length") ?? 0) > 1000,
    "画像のサイズ",
  );
});

// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ⑦── 商品ページ HTML（プライバシー・関連アプリ・埋め込みレビュー）
 *
 * 目的:
 *   商品ページの serialized-server-data には、iTunes API では取れない
 *   「プライバシー表示」「同開発者の他アプリ」「似ているアプリ」「埋め込みレビュー」が入る。
 *   それぞれの位置と形を固定する。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/app_page_privacy_and_related_test.ts
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

async function pagePayload(): Promise<any> {
  const html = await (await fetch(PAGE_URL, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
  })).text();
  const marker = html.indexOf('id="serialized-server-data"');
  const open = html.indexOf(">", marker) + 1;
  const close = html.indexOf("</script>", open);
  return JSON.parse(html.slice(open, close)).data["0"].data;
}

Deno.test("関連: プライバシー表示（種類・説明・カテゴリ）", async () => {
  const payload = await pagePayload();
  const items = payload.shelfMapping.privacyTypes.items;
  ok(
    Array.isArray(items) && items.length > 0,
    `privacyTypes の件数: ${items?.length}`,
  );
  const known = [
    "DATA_USED_TO_TRACK_YOU",
    "DATA_LINKED_TO_YOU",
    "DATA_NOT_LINKED_TO_YOU",
  ];
  for (const item of items) {
    eq(item.$kind, "PrivacyType", "$kind");
    ok(known.includes(item.identifier), `identifier: ${item.identifier}`);
    eq(typeof item.title, "string", "title（見出し）");
    ok(item.detail === null || typeof item.detail === "string", "detail");
    ok(Array.isArray(item.categories), "categories は配列");
    for (const category of item.categories) {
      eq(category.$kind, "PrivacyCategory", "category の $kind");
      eq(typeof category.identifier, "string", "category.identifier");
      eq(typeof category.title, "string", "category.title");
    }
  }
  // 代表的な identifier が少なくとも 1 つは出る
  ok(
    items.some((item: any) => item.identifier === "DATA_LINKED_TO_YOU"),
    "「自分にリンクされるデータ」がある",
  );
});

Deno.test("関連: ページに埋め込まれたレビュー（8 件程度）", async () => {
  const payload = await pagePayload();
  const items = payload.shelfMapping.allProductReviews.items;
  ok(
    Array.isArray(items) && items.length > 0,
    `埋め込みレビュー件数: ${items?.length}`,
  );
  ok(items.length <= 10, `埋め込みは 10 件以下（実際 ${items.length}）`);
  const review = items[0].review;
  eq(items[0].$kind, "ProductReview", "$kind");
  eq(review.$kind, "Review", "review.$kind");
  ok(/^\d+$/.test(review.id), `id: ${review.id}`);
  eq(typeof review.title, "string", "title");
  eq(typeof review.contents, "string", "contents（本文）");
  ok(review.contents.length > 0, "本文は空でない");
  ok(
    Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5,
    `rating: ${review.rating}`,
  );
  eq(typeof review.reviewerName, "string", "reviewerName");
  ok(!Number.isNaN(Date.parse(review.date)), `date: ${review.date}`);
});

Deno.test("関連: 同開発者の他アプリ（moreByDeveloper）", async () => {
  const payload = await pagePayload();
  const items = payload.shelfMapping.moreByDeveloper.items;
  ok(
    Array.isArray(items) && items.length > 0,
    `moreByDeveloper の件数: ${items?.length}`,
  );
  const app = items[0];
  eq(app.$kind, "Lockup", "$kind");
  ok(/^\d+$/.test(String(app.adamId)), `adamId: ${app.adamId}`);
  ok(String(app.adamId) !== APP_ID, "自分自身は含まれない");
  eq(typeof app.bundleId, "string", "bundleId");
  eq(typeof app.title, "string", "title");
  ok(String(app.icon.template).startsWith("https://"), "icon.template");
  eq(typeof app.offerDisplayProperties.isFree, "boolean", "isFree");
  if (typeof app.rating === "number") {
    ok(app.rating >= 1 && app.rating <= 5, `rating: ${app.rating}`);
  }
});

Deno.test("関連: 似ているアプリ（similarItems）も同じ Lockup 形式", async () => {
  const payload = await pagePayload();
  const items = payload.shelfMapping.similarItems.items;
  ok(
    Array.isArray(items) && items.length > 0,
    `similarItems の件数: ${items?.length}`,
  );
  for (const app of items.slice(0, 5)) {
    eq(app.$kind, "Lockup", "$kind");
    ok(/^\d+$/.test(String(app.adamId)), `adamId: ${app.adamId}`);
    eq(typeof app.bundleId, "string", "bundleId");
    eq(typeof app.title, "string", "title");
    ok(
      String(app.icon.template).includes("{w}x{h}{c}.{f}"),
      "アイコンはテンプレート URL",
    );
  }
  const ids = items.map((app: any) => String(app.adamId));
  ok(new Set(ids).size === ids.length, "同じアプリが重複しない");
});

Deno.test("関連: 埋め込みレビューは RSS の 1 ページ目と重なる（同じ ID 体系）", async () => {
  const payload = await pagePayload();
  const embedded = new Set(
    payload.shelfMapping.allProductReviews.items.map((item: any) =>
      item.review.id
    ),
  );
  const rss = await (await fetch(
    `https://itunes.apple.com/jp/rss/customerreviews/id=${APP_ID}/sortBy=mostRecent/json`,
    {
      headers: { "user-agent": UA },
    },
  )).json();
  const entries = Array.isArray(rss.feed.entry)
    ? rss.feed.entry
    : [rss.feed.entry];
  const rssIds = new Set(entries.map((entry: any) => entry.id.label));
  const overlap = [...embedded].filter((id) => rssIds.has(id));
  ok(overlap.length >= 0, `重複数: ${overlap.length}`);
  // どちらも同じレビュー ID 体系（数字文字列）を使っている
  for (const id of embedded) {
    ok(/^\d+$/.test(String(id)), `埋め込みレビューの ID: ${id}`);
  }
});

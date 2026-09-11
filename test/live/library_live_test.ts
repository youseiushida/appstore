/**
 * ライブラリ検証（ライブ）: 公開 API を実 App Store に対して叩く。
 *
 * ここだけは記録ではなく「今の App Store」が相手。値そのものは変わりうるので、
 * 形と妥当性（空でない・ありえない値でない）を検証する。
 *
 *   deno test --allow-net test/live/library_live_test.ts
 */
import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  AppStoreError,
  getApp,
  getReviews,
  getTopCharts,
  searchApps,
} from "../../src/mod.ts";

const APP_ID = "1059224316";
const BUNDLE_ID = "com.hapihapi.money";
const JP = { country: "jp" } as const;

Deno.test("live: searchApps で日本語の検索結果が取れる", async () => {
  const results = await searchApps("家計簿", { ...JP, limit: 5 });
  assertEquals(results.length > 0, true);
  const first = results[0];
  assertEquals(/^\d+$/.test(first?.id ?? ""), true);
  assertEquals((first?.name.length ?? 0) > 0, true);
  assertEquals(first?.url.startsWith("https://apps.apple.com/"), true);
  assertEquals(first?.price?.currency, "JPY");
});

Deno.test("live: getApp は iTunes API と商品ページの情報を統合して返す", async () => {
  const app = await getApp(APP_ID, JP);
  assertEquals(app.id, APP_ID);
  assertEquals((app.name.length ?? 0) > 0, true);
  assertEquals((app.description.length ?? 0) > 100, true);
  assertEquals(app.screenshots.length > 0, true);
  // 商品ページ由来
  assertEquals((app.subtitle ?? "").length > 0, true);
  assertEquals(app.ratingBreakdown?.length, 5);
  assertEquals(app.privacy.length > 0, true);
  assertEquals(app.relatedApps.length > 0, true);
  assertEquals(app.developerApps.length > 0, true);
  assertEquals(app.information.length > 0, true);
  assertEquals(app.whatsNew !== null, true);
  assertInstanceOf(app.updatedAt, Date);
  assertEquals((app.rating?.count ?? 0) > 0, true);
  assertEquals(app.raw.page !== null, true);
});

Deno.test("live: bundleId でも同じアプリが引け、includePageData で軽くできる", async () => {
  const full = await getApp(APP_ID, JP);
  const light = await getApp(BUNDLE_ID, { ...JP, includePageData: false });
  assertEquals(light.id, full.id);
  assertEquals(light.name, full.name);
  assertEquals(light.subtitle, null, "ページを取らないのでサブタイトルは無い");
  assertEquals(light.ratingBreakdown, null);
  assertEquals(light.raw.page, null);
  assertEquals(
    light.description.length > 100,
    true,
    "Lookup だけでも説明文は取れる",
  );
});

Deno.test("live: getReviews でレビューが取れる（RSS の形を確認）", async () => {
  const page = await getReviews(APP_ID, JP);
  assertEquals(page.page, 1);
  assertEquals(page.items.length > 0 && page.items.length <= 50, true);
  assertEquals(typeof page.hasMore, "boolean");
  const review = page.items[0];
  assertEquals(/^\d+$/.test(review?.id ?? ""), true);
  assertEquals((review?.rating ?? 0) >= 1 && (review?.rating ?? 0) <= 5, true);
  assertInstanceOf(review?.updatedAt, Date);
  assertEquals((review?.body.length ?? 0) > 0, true);
});

Deno.test("live: getTopCharts で順位付きのランキングが取れる", async () => {
  const charts = await getTopCharts({ ...JP, limit: 5 });
  assertEquals(charts.length, 5);
  assertEquals(charts.map((entry) => entry.rank), [1, 2, 3, 4, 5]);
  assertEquals(charts[0]?.icon?.startsWith("https://"), true);
  assertEquals(charts[0]?.url.startsWith("https://apps.apple.com/"), true);
});

Deno.test("live: 存在しないアプリは notFound、page 範囲外は invalidArgument", async () => {
  const missing = await assertRejects(
    () => getApp("999999999999999", JP),
    AppStoreError,
  );
  assertEquals(missing.kind, "notFound");
  const badPage = await assertRejects(
    () => getReviews(APP_ID, { ...JP, page: 11 }),
    AppStoreError,
  );
  assertEquals(badPage.kind, "invalidArgument");
});

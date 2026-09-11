// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { toAppDetailBase, toAppSummary } from "../../src/itunes.ts";
import { pageSnapshot } from "../../src/page.ts";
import { expandArtworkTemplate } from "../../src/parse.ts";
import { parseChart } from "../../src/charts.ts";
import { parseReviews } from "../../src/reviews.ts";
import { loadFixture } from "../helpers/fixture_server.ts";

const bodyOf = (fixture: { body: string }): any => JSON.parse(fixture.body);

Deno.test("parse: Lookup の 1 件を AppSummary / AppDetail に正規化できる", async () => {
  const fixture = await loadFixture("lookup_jp_free");
  const raw = bodyOf(fixture).results[0];
  const summary = toAppSummary(raw);
  assertEquals(summary.id, "1059224316");
  assertEquals(summary.bundleId, "com.hapihapi.money");
  assertMatch(summary.name, /家計簿/);
  assertEquals(summary.developer, "LAN CHEN");
  assertMatch(summary.icon ?? "", /^https:\/\//);
  assertEquals(summary.price, { value: 0, formatted: "無料", currency: "JPY" });
  assertEquals(summary.category, "Finance");
  assertMatch(summary.url, /^https:\/\/apps\.apple\.com\//);
  assertEquals((summary.rating?.count ?? 0) > 0, true);

  const detail = toAppDetailBase(raw);
  assertEquals(detail.description.length > 100, true);
  assertEquals(detail.screenshots.length > 0, true);
  assertEquals(typeof detail.version, "string");
  assertEquals(detail.minimumOsVersion !== null, true);
  assertEquals(detail.sizeBytes !== null && detail.sizeBytes > 0, true);
  assertEquals(detail.languages.includes("JA"), true);
  assertEquals(detail.genres.includes("ファイナンス"), true);
  assertEquals(detail.updatedAt instanceof Date, true);
  // ページ由来の項目は空で作られる
  assertEquals(detail.subtitle, null);
  assertEquals(detail.ratingBreakdown, null);
  assertEquals(detail.privacy, []);
  assertEquals(detail.raw.page, null);
});

Deno.test("parse: 有料アプリの価格がそのまま取れる", async () => {
  const fixture = await loadFixture("lookup_jp_paid");
  const summary = toAppSummary(bodyOf(fixture).results[0]);
  assertEquals(summary.price?.currency, "JPY");
  assertMatch(summary.price?.formatted ?? "", /^¥/);
  assertEquals((summary.price?.value ?? 0) > 0, true);
});

Deno.test("parse: 商品ページから ASO に必要な情報を取り出せる", async () => {
  const fixture = await loadFixture("page_jp_free");
  const page = pageSnapshot(fixture.body, "jp");

  assertEquals(typeof page.subtitle, "string");
  assertEquals((page.subtitle ?? "").length > 0, true);
  assertEquals(page.ratingBreakdown?.length, 5);
  assertEquals(
    page.ratingAverage !== null && page.ratingAverage > 1 &&
      page.ratingAverage <= 5,
    true,
  );
  const breakdownTotal = (page.ratingBreakdown ?? []).reduce(
    (sum, count) => sum + count,
    0,
  );
  assertEquals(
    page.ratingCount !== null &&
      Math.abs(breakdownTotal - page.ratingCount) / page.ratingCount < 0.001,
    true,
  );
  assertEquals(page.privacy.length > 0, true);
  assertEquals((page.privacy[0]?.identifier ?? "").length > 0, true);
  assertEquals((page.privacy[0]?.categories ?? []).length > 0, true);
  assertEquals(page.inAppPurchases.length > 0, true);
  assertMatch(page.inAppPurchases[0]?.price ?? "", /¥/);
  assertEquals(page.relatedApps.length > 0, true);
  assertEquals(page.developerApps.length > 0, true);
  assertEquals(page.information.length > 0, true);
  assertEquals(page.information.some((item) => item.title === "販売元"), true);
  assertEquals(page.screenshots.length > 0, true);
  assertMatch(page.screenshots[0] ?? "", /^https:\/\/.+\.(jpe?g|png)$/);
  assertEquals((page.whatsNew?.text ?? "").length > 0, true);
  assertMatch(page.whatsNew?.versionLabel ?? "", /バージョン/);
  assertEquals(page.whatsNew?.date instanceof Date, true);
  assertEquals(
    page.relatedApps[0]?.url,
    `https://apps.apple.com/jp/app/id${page.relatedApps[0]?.id}`,
  );
});

Deno.test("parse: ページの星別内訳は 5★→1★ の順（重み付き平均で検証）", async () => {
  const pageFixture = await loadFixture("page_jp_free");
  const lookupFixture = await loadFixture("lookup_jp_free");
  const page = pageSnapshot(pageFixture.body, "jp");
  const api = toAppSummary(bodyOf(lookupFixture).results[0]);
  const counts = page.ratingBreakdown as [
    number,
    number,
    number,
    number,
    number,
  ];
  const total = counts.reduce((sum, count) => sum + count, 0);
  const weighted =
    counts.reduce((sum, count, index) => sum + count * (5 - index), 0) / total;
  assertEquals(Math.abs(weighted - (api.rating?.average ?? 0)) < 0.15, true);
});

Deno.test("parse: レビュー RSS を正規化できる（仮名化済み fixture）", async () => {
  const fixture = await loadFixture("reviews_most_recent");
  const reviews = parseReviews(bodyOf(fixture));
  assertEquals(reviews.length, 50);
  for (const review of reviews.slice(0, 5)) {
    assertMatch(review.id, /^\d+$/);
    assertMatch(review.author, /^reviewer-\d+$/);
    assertEquals(review.rating >= 1 && review.rating <= 5, true);
    assertEquals(review.title, "サンプルレビュータイトル");
    assertEquals(review.body.includes("サンプルレビュー本文"), true);
    assertEquals(review.updatedAt instanceof Date, true);
    assertEquals(review.updatedAt.getTime() > 0, true);
    assertEquals(typeof review.voteSum, "number");
    assertEquals(typeof review.voteCount, "number");
  }
  assertEquals(reviews[0]?.version !== null, true);
});

Deno.test("parse: レビューが 1 件のとき feed.entry が単一オブジェクトでも配列に揃える", () => {
  const single = {
    feed: {
      entry: {
        id: { label: "123" },
        title: { label: "t" },
        content: { label: "c" },
        "im:rating": { label: "4" },
        "im:version": { label: "1.0" },
        updated: { label: "2026-01-01T00:00:00-07:00" },
        author: { name: { label: "someone" } },
        "im:voteSum": { label: "1" },
        "im:voteCount": { label: "2" },
      },
    },
  };
  const reviews = parseReviews(single);
  assertEquals(reviews.length, 1);
  assertEquals(reviews[0]?.id, "123");
  assertEquals(reviews[0]?.rating, 4);
  assertEquals(reviews[0]?.author, "someone");
  assertEquals(reviews[0]?.updatedAt.toISOString(), "2026-01-01T07:00:00.000Z");
});

Deno.test("parse: レビュー 0 件（entry 無し）は空配列になる", async () => {
  const fixture = await loadFixture("reviews_empty");
  assertEquals(parseReviews(bodyOf(fixture)).length, 0);
});

Deno.test("parse: チャートの順位・アイコン・価格・URL", async () => {
  const fixture = await loadFixture("charts_top_free");
  const chart = parseChart(bodyOf(fixture));
  assertEquals(chart.length, 5);
  assertEquals(chart.map((entry) => entry.rank), [1, 2, 3, 4, 5]);
  for (const entry of chart) {
    assertMatch(entry.id, /^\d+$/);
    assertEquals(entry.bundleId.length > 0, true);
    assertEquals(entry.name.length > 0, true);
    assertEquals(entry.developer.length > 0, true);
    assertMatch(entry.icon ?? "", /^https:\/\/.+\.(jpe?g|png)$/);
    assertEquals(entry.price?.currency, "JPY");
    assertMatch(entry.url, /^https:\/\/apps\.apple\.com\//);
  }
  // アイコンは 3 サイズのうち最大のものを選ぶ
  assertExists(chart[0]?.raw);
});

Deno.test("parse: 画像テンプレートを実 URL に展開できる", () => {
  assertEquals(
    expandArtworkTemplate(
      "https://example.com/{w}x{h}{c}.{f}",
      1284,
      2778,
      "jpg",
    ),
    "https://example.com/1284x2778bb.jpg",
  );
  assertEquals(
    expandArtworkTemplate("https://example.com/{w}x{h}{c}.{f}", 512, 512),
    "https://example.com/512x512bb.jpg",
  );
});

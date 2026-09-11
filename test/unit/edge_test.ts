/**
 * 欠けたフィールド・想定外の形に対する振る舞いを固定する。
 * Apple 側が項目を減らしても、パーサは例外を投げずに既定値へ落ちる。
 */
import { assertEquals, assertThrows } from "@std/assert";
import { parseChart } from "../../src/charts.ts";
import { AppStoreError } from "../../src/errors.ts";
import { toAppDetailBase, toAppSummary } from "../../src/itunes.ts";
import {
  extractLdJson,
  extractScriptJson,
  pageSnapshot,
} from "../../src/page.ts";
import { artworkUrl, toRelatedApp } from "../../src/parse.ts";
import { parseReviews } from "../../src/reviews.ts";

function pageHtml(payload: unknown): string {
  return `<html><script type="application/json" id="serialized-server-data">${
    JSON.stringify({ data: { "0": { data: payload } } })
  }</script></html>`;
}

Deno.test("edge: iTunes の欠けたフィールドは null / 既定値に落ちる", () => {
  const summary = toAppSummary({ trackId: 1, trackName: "n" });
  assertEquals(summary.id, "1");
  assertEquals(summary.bundleId, "");
  assertEquals(summary.developer, "");
  assertEquals(summary.icon, null);
  assertEquals(summary.rating, null);
  assertEquals(summary.price, null);
  assertEquals(summary.category, null);
  assertEquals(summary.url, "");

  const detail = toAppDetailBase({
    trackId: 2,
    fileSizeBytes: "abc",
    currentVersionReleaseDate: "not a date",
  });
  assertEquals(detail.sizeBytes, null);
  assertEquals(detail.updatedAt, null);
  assertEquals(detail.version, null);
  assertEquals(detail.releaseNotes, null);
  assertEquals(detail.minimumOsVersion, null);
  assertEquals(detail.contentRating, null);
  assertEquals(detail.screenshots, []);
  assertEquals(detail.languages, []);
  assertEquals(detail.genres, []);
});

Deno.test("edge: artwork ヘルパーはテンプレートの有無どちらでも動く", () => {
  assertEquals(artworkUrl(null), null);
  assertEquals(
    artworkUrl({ template: "https://example.com/plain.png" }),
    "https://example.com/plain.png",
  );
  assertEquals(
    artworkUrl({
      template: "https://x/{w}x{h}{c}.{f}",
      width: 10,
      height: 20,
      variants: [{ format: "png" }],
    }),
    "https://x/10x20bb.png",
  );
  assertEquals(
    artworkUrl({ template: "https://x/{w}x{h}{c}.{f}", width: 10, height: 20 }),
    "https://x/10x20bb.jpg",
  );
  assertEquals(artworkUrl({ template: 123 }), null);
});

Deno.test("edge: 関連アプリは adamId が無ければ URL を空にする", () => {
  const related = toRelatedApp({ title: "t" }, "jp");
  assertEquals(related.id, "");
  assertEquals(related.url, "");
  assertEquals(related.price, null);
  assertEquals(related.icon, null);
});

Deno.test("edge: チャートは欠けたフィールドでも落ちない", () => {
  const minimal = parseChart({
    feed: {
      entry: [{
        id: { attributes: { "im:id": "1" } },
        "im:name": { label: "n" },
      }],
    },
  });
  assertEquals(minimal.length, 1);
  assertEquals(minimal[0]?.rank, 1);
  assertEquals(minimal[0]?.id, "1");
  assertEquals(minimal[0]?.icon, null);
  assertEquals(minimal[0]?.price, null);
  assertEquals(minimal[0]?.category, null);
  assertEquals(minimal[0]?.url, "");
  assertEquals(minimal[0]?.developer, "");
  assertEquals(minimal[0]?.bundleId, "");

  const withImages = parseChart({
    feed: {
      entry: [{
        id: { attributes: {} },
        "im:image": [
          { label: "small", attributes: { height: "55" } },
          { label: "large", attributes: { height: "170" } },
        ],
        link: [
          { attributes: { rel: "enclosure", href: "enc" } },
          { attributes: { rel: "alternate", href: "alt" } },
        ],
        "im:price": { label: "無料", attributes: { currency: "JPY" } },
      }],
    },
  });
  assertEquals(withImages[0]?.icon, "large");
  assertEquals(withImages[0]?.url, "alt");
  assertEquals(withImages[0]?.price, { formatted: "無料", currency: "JPY" });

  // entry が単一オブジェクトでも配列に正規化される
  assertEquals(
    parseChart({ feed: { entry: { id: { attributes: { "im:id": "9" } } } } })
      .length,
    1,
  );
  assertEquals(parseChart({}).length, 0);
});

Deno.test("edge: レビューは欠けたラベルでも落ちない", () => {
  const reviews = parseReviews({ feed: { entry: [{ id: { label: "1" } }] } });
  assertEquals(reviews.length, 1);
  assertEquals(reviews[0]?.title, "");
  assertEquals(reviews[0]?.body, "");
  assertEquals(reviews[0]?.author, "");
  assertEquals(reviews[0]?.rating, 0);
  assertEquals(reviews[0]?.version, null);
  assertEquals(reviews[0]?.updatedAt.getTime(), 0);
  assertEquals(reviews[0]?.voteSum, 0);
  assertEquals(reviews[0]?.voteCount, 0);
  assertEquals(parseReviews({}).length, 0);
});

Deno.test("edge: 商品ページの想定外の形は parse エラー", () => {
  const missing = assertThrows(
    () => extractScriptJson("<html></html>", "serialized-server-data"),
    AppStoreError,
  );
  assertEquals(missing.kind, "parse");
  const broken = assertThrows(
    () =>
      extractScriptJson(
        '<script id="serialized-server-data">not json</script>',
        "serialized-server-data",
      ),
    AppStoreError,
  );
  assertEquals(broken.kind, "parse");
  const noData = assertThrows(
    () =>
      pageSnapshot(
        '<script id="serialized-server-data">{"data":{"0":{}}}</script>',
        "jp",
      ),
    AppStoreError,
  );
  assertEquals(noData.kind, "parse");
  assertEquals(extractLdJson("<html></html>", "SoftwareApplication"), null);
  assertEquals(
    extractLdJson(
      '<script type="application/ld+json">broken</script>',
      "SoftwareApplication",
    ),
    null,
  );
});

Deno.test("edge: ページに情報が無くても既定値で返す", () => {
  const page = pageSnapshot(pageHtml({ shelfMapping: {}, lockup: {} }), "jp");
  assertEquals(page.subtitle, null);
  assertEquals(page.description, null);
  assertEquals(page.ratingAverage, null);
  assertEquals(page.ratingCount, null);
  assertEquals(page.ratingBreakdown, null);
  assertEquals(page.whatsNew, null);
  assertEquals(page.screenshots, []);
  assertEquals(page.privacy, []);
  assertEquals(page.inAppPurchases, []);
  assertEquals(page.relatedApps, []);
  assertEquals(page.developerApps, []);
  assertEquals(page.information, []);
});

Deno.test("edge: 星別内訳が 5 件でなければ null、日付が不正なら null", () => {
  const page = pageSnapshot(
    pageHtml({
      shelfMapping: {
        productRatings: {
          items: [{
            ratingAverage: 4.5,
            totalNumberOfRatings: 100,
            ratingCounts: [1, 2, 3],
          }],
        },
        mostRecentVersion: {
          items: [{
            text: "t",
            primarySubtitle: "Version 1.0",
            secondarySubtitle: "invalid",
          }],
        },
      },
      lockup: {},
    }),
    "us",
  );
  assertEquals(page.ratingBreakdown, null);
  assertEquals(page.whatsNew?.text, "t");
  assertEquals(page.whatsNew?.date, null);
});

Deno.test("edge: アプリ内購入の価格が欠けていても空文字で返す", () => {
  const page = pageSnapshot(
    pageHtml({
      shelfMapping: {
        information: {
          items: [
            { title: "販売元", items: [{ text: "dev" }] },
            {
              title: "アプリ内購入",
              items: [{ textPairs: [["アイテム"], ["もう一つ", "¥100"]] }],
            },
          ],
        },
      },
      lockup: {},
    }),
    "jp",
  );
  assertEquals(page.inAppPurchases, [
    { name: "アイテム", price: "" },
    { name: "もう一つ", price: "¥100" },
  ]);
  assertEquals(page.information.length, 2);
  assertEquals(page.information[0]?.value, "dev");
  // textPairs しか無い注釈は "名前 価格" を連結した文字列になる
  assertEquals(page.information[1]?.value, "アイテム / もう一つ ¥100");
});

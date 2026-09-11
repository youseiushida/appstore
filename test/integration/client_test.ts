// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertMatch } from "@std/assert";
import { getApp, getReviews, getTopCharts, searchApps } from "../../src/mod.ts";
import {
  loadFixtures,
  type RecordedRequest,
  withFixtureServers,
} from "../helpers/fixture_server.ts";

const FIXTURES = [
  "lookup_jp_free",
  "lookup_jp_paid",
  "lookup_us_global",
  "lookup_by_bundle_id",
  "search_kakeibo_jp",
  "search_facebook_us",
  "page_jp_free",
  "page_jp_paid",
  "reviews_most_recent",
  "reviews_most_helpful",
  "charts_top_free",
  "charts_top_paid",
  "charts_new",
  "charts_top_free_education",
];

const JP = { country: "jp" } as const;

function requestsOf(
  servers: { requests: RecordedRequest[] },
  face: "itunes" | "apps",
): RecordedRequest[] {
  return servers.requests.filter((request) => request.face === face);
}

Deno.test("searchApps: 検索結果を正規化して返し、entity=software を送る", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const results = await searchApps("家計簿", {
      ...JP,
      limit: 5,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(results.length, 5);
    assertMatch(results[0]?.name ?? "", /家計簿/);
    assertEquals(results[0]?.price?.currency, "JPY");

    const request = requestsOf(servers, "itunes")[0];
    assertEquals(request?.pathname, "/search");
    assertEquals(request?.params.term, "家計簿");
    assertEquals(request?.params.country, "jp");
    assertEquals(request?.params.entity, "software");
    assertEquals(request?.params.limit, "5");
  });
});

Deno.test("getApp: Lookup の情報に商品ページの情報を足して返す", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const app = await getApp("1059224316", {
      ...JP,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });

    // iTunes API 由来
    assertEquals(app.id, "1059224316");
    assertEquals(app.bundleId, "com.hapihapi.money");
    assertEquals(app.price, { value: 0, formatted: "無料", currency: "JPY" });
    assertEquals(app.description.length > 100, true);
    // 商品ページ由来
    assertEquals(typeof app.subtitle, "string");
    assertEquals(app.ratingBreakdown?.length, 5);
    assertEquals(app.privacy.length > 0, true);
    assertEquals(app.inAppPurchases.length > 0, true);
    assertEquals(app.relatedApps.length, 10);
    assertEquals(app.developerApps.length, 15);
    assertEquals(app.information.some((item) => item.title === "販売元"), true);
    assertEquals(app.screenshots.length, 6);
    assertEquals(app.whatsNew !== null, true);
    // 生データは両方残る
    assertEquals((app.raw.lookup as any).trackId, 1059224316);
    assertEquals(app.raw.page !== null, true);

    const requests = servers.requests;
    assertEquals(requests.length, 2, "Lookup とページの 2 回だけ");
    assertEquals(requests[0]?.face, "itunes");
    assertEquals(requests[1]?.face, "apps");
    assertEquals(requests[1]?.pathname, "/jp/app/id1059224316");
  });
});

Deno.test("getApp: bundleId でも引ける（includePageData: false ならページを取りに行かない）", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const app = await getApp("com.hapihapi.money", {
      ...JP,
      includePageData: false,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(app.id, "1059224316");
    assertEquals(app.subtitle, null);
    assertEquals(app.ratingBreakdown, null);
    assertEquals(
      app.screenshots.length > 0,
      true,
      "Lookup だけでもスクリーンショットは取れる",
    );
    assertEquals(app.raw.page, null);
    assertEquals(servers.requests.length, 1);
    assertEquals(servers.requests[0]?.params.bundleId, "com.hapihapi.money");
  });
});

Deno.test("getReviews: レビューを正規化して返し、page と sortBy をパスに載せる", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const page = await getReviews("1059224316", {
      ...JP,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(page.items.length, 50);
    assertEquals(page.page, 1);
    assertEquals(page.hasMore, true);
    assertMatch(page.items[0]?.author ?? "", /^reviewer-\d+$/);
    const firstRating = page.items[0]?.rating ?? 0;
    assertEquals(firstRating >= 1 && firstRating <= 5, true);
    assertEquals(page.raw !== null, true);
    assertEquals(
      servers.requests[0]?.pathname,
      "/jp/rss/customerreviews/page=1/id=1059224316/sortBy=mostRecent/json",
    );
  });
});

Deno.test("getReviews: sort=mostHelpful で並び順を切り替えられる", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const page = await getReviews("1059224316", {
      ...JP,
      sort: "mostHelpful",
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(page.items.length, 50);
    assertEquals(
      servers.requests[0]?.pathname,
      "/jp/rss/customerreviews/page=1/id=1059224316/sortBy=mostHelpful/json",
    );
  });
});

Deno.test("getTopCharts: 順位付きで返し、limit を反映して送る", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const charts = await getTopCharts({
      ...JP,
      limit: 50,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(charts.length, 5, "fixture は 5 件を返す");
    assertEquals(charts[0]?.rank, 1);
    assertEquals(charts.map((entry) => entry.rank), [1, 2, 3, 4, 5]);
    assertMatch(charts[0]?.url ?? "", /^https:\/\/apps\.apple\.com\//);
    assertEquals(
      servers.requests[0]?.pathname,
      "/jp/rss/topfreeapplications/limit=50/json",
    );
  });
});

Deno.test("getTopCharts: chart と genre を切り替えられる", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    await getTopCharts({
      ...JP,
      chart: "topPaid",
      limit: 5,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    await getTopCharts({
      ...JP,
      chart: "topFree",
      genre: 6017,
      limit: 5,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(
      servers.requests[0]?.pathname,
      "/jp/rss/toppaidapplications/limit=5/json",
    );
    assertEquals(
      servers.requests[1]?.pathname,
      "/jp/rss/topfreeapplications/limit=5/genre=6017/json",
    );
  });
});

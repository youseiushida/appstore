import { assertEquals } from "@std/assert";
import {
  DEFAULT_COUNTRY,
  getApp,
  getReviews,
  searchApps,
} from "../../src/mod.ts";
import { loadFixtures, withFixtureServers } from "../helpers/fixture_server.ts";

const FIXTURES = [
  "lookup_jp_free",
  "lookup_us_global",
  "search_kakeibo_jp",
  "search_facebook_us",
  "page_jp_free",
  "reviews_most_recent",
];

Deno.test("オプション: country の既定は us", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    await searchApps("facebook", {
      limit: 5,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(servers.requests[0]?.params.country, DEFAULT_COUNTRY);
  });
});

Deno.test("オプション: lang は iTunes API と商品ページの両方に渡る", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    await getApp("1059224316", {
      country: "jp",
      lang: "ja_jp",
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(servers.requests[0]?.params.lang, "ja_jp");
    assertEquals(servers.requests[1]?.params.l, "ja_jp");
  });
});

Deno.test("オプション: includePageData: false なら Lookup だけを叩く", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    await getApp("1059224316", {
      country: "jp",
      includePageData: false,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(servers.requests.length, 1);
    assertEquals(servers.requests[0]?.face, "itunes");
  });
});

Deno.test("オプション: baseUrl は末尾スラッシュの有無どちらでも同じパスになる", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    await searchApps("家計簿", {
      country: "jp",
      limit: 5,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    await searchApps("家計簿", {
      country: "jp",
      limit: 5,
      itunesBaseUrl: `${servers.itunesUrl}/`,
      appsBaseUrl: `${servers.appsUrl}/`,
    });
    assertEquals(servers.requests.map((request) => request.pathname), [
      "/search",
      "/search",
    ]);
  });
});

Deno.test("オプション: getReviews は page をそのまま URL に載せる", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const page = await getReviews("1059224316", {
      country: "jp",
      page: 1,
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(page.page, 1);
    assertEquals(page.hasMore, true);
    assertEquals(
      servers.requests[0]?.pathname,
      "/jp/rss/customerreviews/page=1/id=1059224316/sortBy=mostRecent/json",
    );
  });
});

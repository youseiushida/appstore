import { assertEquals } from "@std/assert";
import { chartUrl } from "../../src/charts.ts";
import { lookupUrl, searchUrl } from "../../src/itunes.ts";
import { reviewsUrl } from "../../src/reviews.ts";

Deno.test("url: Search API（entity=software と limit が必ず入る）", () => {
  const url = searchUrl("https://itunes.apple.com", "家計簿", {
    country: "jp",
    limit: 5,
  });
  assertEquals(url.pathname, "/search");
  assertEquals(url.searchParams.get("term"), "家計簿");
  assertEquals(url.searchParams.get("country"), "jp");
  assertEquals(url.searchParams.get("entity"), "software");
  assertEquals(url.searchParams.get("limit"), "5");
  assertEquals(url.searchParams.get("lang"), null);
});

Deno.test("url: Search API の lang は指定したときだけ付く", () => {
  const url = searchUrl("https://itunes.apple.com/", "家計簿", {
    country: "jp",
    limit: 5,
    lang: "ja_jp",
  });
  assertEquals(url.searchParams.get("lang"), "ja_jp");
});

Deno.test("url: Lookup API は id と bundleId を切り替える", () => {
  const byId = lookupUrl("https://itunes.apple.com", { id: "1059224316" }, {
    country: "jp",
  });
  assertEquals(byId.pathname, "/lookup");
  assertEquals(byId.searchParams.get("id"), "1059224316");
  assertEquals(byId.searchParams.get("bundleId"), null);
  const byBundle = lookupUrl("https://itunes.apple.com", {
    bundleId: "com.hapihapi.money",
  }, { country: "jp" });
  assertEquals(byBundle.searchParams.get("bundleId"), "com.hapihapi.money");
  assertEquals(byBundle.searchParams.get("id"), null);
});

Deno.test("url: レビュー RSS（page と sortBy がパスに入る）", () => {
  const url = reviewsUrl("https://itunes.apple.com", "1059224316", {
    country: "jp",
    page: 2,
    sort: "mostHelpful",
  });
  assertEquals(
    url.pathname,
    "/jp/rss/customerreviews/page=2/id=1059224316/sortBy=mostHelpful/json",
  );
});

Deno.test("url: ランキング RSS（limit の後ろに genre が付く）", () => {
  const plain = chartUrl("https://itunes.apple.com", {
    country: "jp",
    chart: "topFree",
    limit: 50,
  });
  assertEquals(plain.pathname, "/jp/rss/topfreeapplications/limit=50/json");
  const withGenre = chartUrl("https://itunes.apple.com", {
    country: "jp",
    chart: "topGrossing",
    genre: 6017,
    limit: 10,
  });
  assertEquals(
    withGenre.pathname,
    "/jp/rss/topgrossingapplications/limit=10/genre=6017/json",
  );
});

import { assertEquals, assertRejects } from "@std/assert";
import {
  AppStoreError,
  getApp,
  getReviews,
  getTopCharts,
  searchApps,
} from "../../src/mod.ts";
import {
  loadFixtures,
  startFixtureServers,
  withFixtureServers,
} from "../helpers/fixture_server.ts";

const FIXTURES = [
  "lookup_jp_free",
  "lookup_not_found",
  "search_kakeibo_jp",
  "page_jp_free",
  "page_not_found",
  "reviews_most_recent",
];
const JP = { country: "jp" } as const;

const base = (servers: { itunesUrl: string; appsUrl: string }) => ({
  itunesBaseUrl: servers.itunesUrl,
  appsBaseUrl: servers.appsUrl,
});

Deno.test("失敗: 存在しないアプリは notFound", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const error = await assertRejects(
      () => getApp("999999999999999", { ...JP, ...base(servers) }),
      AppStoreError,
    );
    assertEquals(error.kind, "notFound");
  });
});

Deno.test("失敗: 商品ページだけ 404 の場合は Lookup の情報を返す（例外にしない）", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    // page_not_found は /us/app/id1059224316 を 404 で返す。us で問い合わせると
    // lookup は見つかるがページが無い、という状態になる。
    const app = await getApp("1059224316", {
      country: "us",
      itunesBaseUrl: servers.itunesUrl,
      appsBaseUrl: servers.appsUrl,
    });
    assertEquals(app.id, "1059224316");
    assertEquals(app.raw.page, null, "ページは取れていない");
    assertEquals(app.subtitle, null);
  });
});

Deno.test("失敗: page が範囲外なら invalidArgument（リクエストは送らない）", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    for (const page of [0, 11, -1]) {
      const error = await assertRejects(
        () => getReviews("1059224316", { ...JP, page, ...base(servers) }),
        AppStoreError,
      );
      assertEquals(error.kind, "invalidArgument", `page=${page}`);
    }
    assertEquals(servers.requests.length, 0, "fetch は発生しない");
  });
});

Deno.test("失敗: 引数が不正なら invalidArgument", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const cases: (() => Promise<unknown>)[] = [
      () => searchApps("   ", { ...JP, ...base(servers) }),
      () => searchApps("家計簿", { ...JP, limit: 0, ...base(servers) }),
      () => searchApps("家計簿", { ...JP, limit: 999, ...base(servers) }),
      () => getApp("", { ...JP, ...base(servers) }),
      () => getReviews("", { ...JP, ...base(servers) }),
      () => getReviews("1059224316", { ...JP, page: 11, ...base(servers) }),
      () => getTopCharts({ ...JP, limit: 0, ...base(servers) }),
      () => getTopCharts({ ...JP, genre: -1, ...base(servers) }),
      () => getTopCharts({ country: "jpn", ...base(servers) }),
    ];
    for (const call of cases) {
      const error = await assertRejects(call, AppStoreError);
      assertEquals(error.kind, "invalidArgument");
    }
    assertEquals(servers.requests.length, 0);
  });
});

Deno.test("失敗: HTTP 500 は kind=http / status=500", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const error = await assertRejects(
      () => searchApps("家計簿", { ...JP, limit: 5, ...base(servers) }),
      AppStoreError,
    );
    assertEquals(error.kind, "http");
    assertEquals(error.status, 500);
  }, () => ({ status: 500, body: "server error" }));
});

Deno.test("失敗: RSS が JSON でない 400 を返したら kind=http", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(
    fixtures,
    async (servers) => {
      const error = await assertRejects(
        () => getReviews("1059224316", { ...JP, ...base(servers) }),
        AppStoreError,
      );
      assertEquals(error.kind, "http");
      assertEquals(error.status, 400);
    },
    () => ({
      status: 400,
      body: "CustomerReviews RSS page depth is limited to 10",
    }),
  );
});

Deno.test("失敗: JSON として読めない応答は kind=parse", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(
    fixtures,
    async (servers) => {
      const error = await assertRejects(
        () => searchApps("家計簿", { ...JP, limit: 5, ...base(servers) }),
        AppStoreError,
      );
      assertEquals(error.kind, "parse");
    },
    () => ({
      status: 200,
      body: "<html>not json</html>",
      contentType: "text/html",
    }),
  );
});

Deno.test("失敗: 接続できないときは kind=network", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  const servers = await startFixtureServers(fixtures);
  const urls = base(servers);
  await servers.close();
  const error = await assertRejects(
    () => searchApps("家計簿", { ...JP, limit: 5, ...urls }),
    AppStoreError,
  );
  assertEquals(error.kind, "network");
});

Deno.test("失敗: timeoutMs を超えると kind=timeout", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const error = await assertRejects(
      () =>
        searchApps("家計簿", {
          ...JP,
          limit: 5,
          timeoutMs: 50,
          ...base(servers),
        }),
      AppStoreError,
    );
    assertEquals(error.kind, "timeout");
    await new Promise((done) => setTimeout(done, 250));
  }, () => ({ delayMs: 200 }));
});

Deno.test("失敗: signal で中断すると kind=aborted", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const controller = new AbortController();
    const promise = searchApps("家計簿", {
      ...JP,
      limit: 5,
      signal: controller.signal,
      ...base(servers),
    });
    controller.abort();
    const error = await assertRejects(() => promise, AppStoreError);
    assertEquals(error.kind, "aborted");
    await new Promise((done) => setTimeout(done, 250));
  }, () => ({ delayMs: 200 }));
});

Deno.test("失敗: すでに abort 済みの signal を渡しても kind=aborted", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    const controller = new AbortController();
    controller.abort();
    const error = await assertRejects(
      () =>
        searchApps("家計簿", {
          ...JP,
          limit: 5,
          signal: controller.signal,
          ...base(servers),
        }),
      AppStoreError,
    );
    assertEquals(error.kind, "aborted");
  });
});

Deno.test("失敗: 数字でも bundleId でもない ID は id として送る", async () => {
  const fixtures = await loadFixtures(FIXTURES);
  await withFixtureServers(fixtures, async (servers) => {
    // どの fixture にも一致しないため 404 になり http エラーとして返る
    const error = await assertRejects(
      () => getApp("abc123", { ...JP, ...base(servers) }),
      AppStoreError,
    );
    assertEquals(error.kind, "http");
    assertEquals(servers.requests[0]?.params.id, "abc123");
  });
});

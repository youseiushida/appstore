/**
 * Node でも動くことの確認（JSR の npm 互換で使われる想定）。
 *
 *   node --experimental-strip-types test/node/smoke.ts
 *
 * Deno の API は使わず、node:http で記録済み応答を返してライブラリを呼ぶ。
 * ライブラリ本体（src/）は標準の fetch と AbortController しか使っていない。
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { getApp, getTopCharts } from "../../src/mod.ts";

const fixture = (name: string): { body: string; contentType: string } =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"),
  );

const lookup = fixture("lookup_jp_free");
const page = fixture("page_jp_free");
const chart = fixture("charts_top_free");

const server = createServer((request, response) => {
  request.on("data", () => {});
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/lookup") {
      response.setHeader("content-type", lookup.contentType);
      response.end(lookup.body);
      return;
    }
    if (url.pathname === "/jp/app/id1059224316") {
      response.setHeader("content-type", page.contentType);
      response.end(page.body);
      return;
    }
    if (url.pathname.includes("/rss/topfreeapplications/")) {
      response.setHeader("content-type", chart.contentType);
      response.end(chart.body);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
});

await new Promise<void>((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve())
);
const address = server.address() as AddressInfo;

try {
  const base = {
    country: "jp",
    itunesBaseUrl: `http://127.0.0.1:${address.port}`,
    appsBaseUrl: `http://127.0.0.1:${address.port}`,
  };
  const app = await getApp("1059224316", base);
  if (app.id !== "1059224316") throw new Error(`unexpected id: ${app.id}`);
  if (!app.subtitle) {
    throw new Error("subtitle が取れていない（ページの解析に失敗）");
  }
  if (app.ratingBreakdown?.length !== 5) {
    throw new Error("星別内訳が取れていない");
  }
  if (app.inAppPurchases.length === 0) {
    throw new Error("アプリ内購入が取れていない");
  }

  const charts = await getTopCharts({ ...base, limit: 5 });
  if (charts.length !== 5) {
    throw new Error(`unexpected chart size: ${charts.length}`);
  }

  console.log(
    `node smoke ok: ${app.name} / ${app.subtitle} / breakdown ${
      app.ratingBreakdown.join(",")
    } / charts ${charts.length}`,
  );
} finally {
  server.close();
}

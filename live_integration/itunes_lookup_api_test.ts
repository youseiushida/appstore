// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ②── iTunes Lookup API
 *
 * 目的:
 *   「ID / bundleId からアプリ 1 件（または複数件）を引く」エンドポイントの仕様を固定する。
 *   Search API との違い（同一のフィールド集合が返ること、存在しない ID の挙動、
 *   ストアフロントによる配信状況の違い）を押さえる。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/itunes_lookup_api_test.ts
 */

const BASE = "https://itunes.apple.com/lookup";
const UA = "Mozilla/5.0 (compatible; appstore-spec/0.1)";
/** 日本語ストアの家計簿アプリ */
const APP_ID = "1059224316";
const BUNDLE_ID = "com.hapihapi.money";
/** 日米どちらでも配信されているアプリ（Facebook） */
const GLOBAL_APP_ID = "284882215";

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

async function lookup(query: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}?${query}`, {
    headers: { "user-agent": UA },
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

Deno.test("Lookup: id で 1 件引ける（Search と同じフィールド集合）", async () => {
  const { status, body } = await lookup(`id=${APP_ID}&country=jp&lang=ja_jp`);
  eq(status, 200, "HTTP ステータス");
  eq(body.resultCount, 1, "resultCount");
  const r = body.results[0];
  eq(r.trackId, Number(APP_ID), "trackId");
  eq(r.bundleId, BUNDLE_ID, "bundleId");
  eq(typeof r.trackName, "string", "trackName");
  eq(typeof r.description, "string", "description");
  ok(Array.isArray(r.screenshotUrls), "screenshotUrls");
  ok(Object.keys(r).length >= 40, `フィールド数: ${Object.keys(r).length}`);
});

Deno.test("Lookup: bundleId でも同じアプリを引ける", async () => {
  const { body } = await lookup(
    `bundleId=${encodeURIComponent(BUNDLE_ID)}&country=jp`,
  );
  eq(body.resultCount, 1, "resultCount");
  eq(body.results[0].trackId, Number(APP_ID), "trackId が一致する");
});

Deno.test("Lookup: カンマ区切りの複数 id を 1 回で引ける（順序は保証されない）", async () => {
  const { body } = await lookup(`id=${APP_ID},${GLOBAL_APP_ID}&country=jp`);
  eq(body.resultCount, 2, "resultCount");
  const ids = body.results.map((r: any) => r.trackId);
  ok(
    ids.includes(Number(APP_ID)) && ids.includes(Number(GLOBAL_APP_ID)),
    `取得した id: ${ids.join(",")}`,
  );
});

Deno.test("Lookup: 存在しない id は 404 ではなく resultCount=0 で返る", async () => {
  const { status, body } = await lookup("id=999999999999999&country=jp");
  eq(status, 200, "HTTP ステータス");
  eq(body.resultCount, 0, "resultCount");
  eq(body.results.length, 0, "results");
});

Deno.test("Lookup: 配信していないストアフロントでは resultCount=0 になる", async () => {
  const jp = await lookup(`id=${APP_ID}&country=jp`);
  eq(jp.body.resultCount, 1, "jp では見つかる");
  // 同じアプリが us に無い場合は 0 件。将来 us でも配信されたら 1 件になるため、
  // 「0 件なら results が空」という形だけを固定する。
  const us = await lookup(`id=${APP_ID}&country=us`);
  if (us.body.resultCount === 0) {
    eq(us.body.results.length, 0, "0 件のとき results は空");
  } else {
    eq(
      us.body.results[0].trackId,
      Number(APP_ID),
      "配信されている場合は同じ trackId",
    );
  }
  const both = await lookup(`id=${GLOBAL_APP_ID}&country=jp`);
  eq(
    both.body.resultCount,
    1,
    "日米どちらでも配信されているアプリは jp で見つかる",
  );
  const bothUs = await lookup(`id=${GLOBAL_APP_ID}&country=us`);
  eq(bothUs.body.resultCount, 1, "同じアプリは us でも見つかる");
});

Deno.test("Lookup: country で通貨・価格が変わる", async () => {
  const jp = await lookup(`id=${GLOBAL_APP_ID}&country=jp`);
  const us = await lookup(`id=${GLOBAL_APP_ID}&country=us`);
  eq(jp.body.results[0].currency, "JPY", "jp の通貨");
  eq(us.body.results[0].currency, "USD", "us の通貨");
  ok(
    jp.body.results[0].formattedPrice !== us.body.results[0].formattedPrice,
    "表示価格も変わる",
  );
});

Deno.test("Lookup: 評価は「平均 + 件数」で、平均は 1〜5 に収まる", async () => {
  const { body } = await lookup(`id=${APP_ID}&country=jp`);
  const r = body.results[0];
  ok(
    r.averageUserRating >= 1 && r.averageUserRating <= 5,
    `averageUserRating: ${r.averageUserRating}`,
  );
  ok(
    Number.isInteger(r.userRatingCount) && r.userRatingCount > 0,
    `userRatingCount: ${r.userRatingCount}`,
  );
  // 詳細な星別内訳は iTunes API には無い（商品ページのデータにのみ存在する）
  eq(r.ratingCounts, undefined, "iTunes API に星別内訳フィールドは無い");
});

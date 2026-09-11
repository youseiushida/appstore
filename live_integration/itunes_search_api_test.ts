// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ①── iTunes Search API
 *
 * 目的:
 *   「キーワード検索」のエンドポイント・パラメータ・返り値の形を固定する。
 *   ヘッドレスブラウザも DOM パーサも使わず、素の fetch と JSON.parse だけで扱える
 *   ことを確認する（薄いライブラリの土台）。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/itunes_search_api_test.ts
 *
 * 記録ではなく「今の iTunes API」が相手なので、値そのものではなく
 * 形・範囲・パラメータの効き方を検証する。
 */

const BASE = "https://itunes.apple.com/search";
const UA = "Mozilla/5.0 (compatible; appstore-spec/0.1)";
/** 日本語ストアで確実に存在する検索語 */
const TERM = "家計簿";
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

async function getJson(
  url: string,
): Promise<{ status: number; contentType: string | null; body: any }> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
}

Deno.test("Search: 基本の URL と応答の形（resultCount + results 配列）", async () => {
  const url = `${BASE}?term=${
    encodeURIComponent(TERM)
  }&country=jp&entity=software&limit=5&lang=ja_jp`;
  const { status, contentType, body } = await getJson(url);
  eq(status, 200, "HTTP ステータス");
  ok(
    contentType?.includes("javascript") || contentType?.includes("json"),
    `content-type: ${contentType}`,
  );
  ok(body && typeof body === "object", "JSON として読める");
  eq(typeof body.resultCount, "number", "resultCount は数値");
  ok(Array.isArray(body.results), "results は配列");
  eq(
    body.resultCount,
    body.results.length,
    "resultCount は results の件数と一致する",
  );
  ok(body.results.length > 0, "結果が 1 件以上ある");
});

Deno.test("Search: entity=software を付けるとアプリだけが返る", async () => {
  const withEntity = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=jp&entity=software&limit=10`,
  );
  const kinds = new Set(withEntity.body.results.map((r: any) => r.kind));
  eq(
    [...kinds].join(","),
    "software",
    "entity=software のとき kind は software のみ",
  );
  for (const result of withEntity.body.results) {
    eq(typeof result.trackId, "number", "trackId");
    eq(typeof result.bundleId, "string", "bundleId");
    eq(typeof result.trackName, "string", "trackName");
    eq(typeof result.artistName, "string", "artistName（開発者名）");
    eq(typeof result.trackViewUrl, "string", "trackViewUrl（商品ページ）");
    ok(
      result.trackViewUrl.includes("apps.apple.com"),
      "trackViewUrl は apps.apple.com",
    );
  }
});

Deno.test("Search: entity を省略するとアプリ以外（書籍・映画など）も混ざる", async () => {
  const withoutEntity = await getJson(
    `${BASE}?term=${encodeURIComponent(TERM)}&country=jp&limit=10`,
  );
  const kinds = new Set(withoutEntity.body.results.map((r: any) => r.kind));
  ok(
    kinds.size > 1 || !kinds.has("software"),
    `entity 無しでは media が混在する: ${[...kinds].join(",")}`,
  );
});

Deno.test("Search: limit は上限として働く（limit=5 で 5 件以下、limit=200 でそれ以上）", async () => {
  const small = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=jp&entity=software&limit=5`,
  );
  ok(
    small.body.results.length <= 5,
    `limit=5 の件数: ${small.body.results.length}`,
  );
  const many = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=jp&entity=software&limit=200`,
  );
  ok(
    many.body.results.length > 5,
    `limit=200 の件数: ${many.body.results.length}`,
  );
  eq(
    many.body.resultCount,
    many.body.results.length,
    "resultCount は実際に返った件数",
  );
});

Deno.test("Search: ヒットが無いときは resultCount=0 / results=[] で 200 が返る", async () => {
  const { status, body } = await getJson(
    `${BASE}?term=zzzzqqqxxyy&country=jp&entity=software&limit=5`,
  );
  eq(status, 200, "HTTP ステータス（404 ではない）");
  eq(body.resultCount, 0, "resultCount");
  eq(body.results.length, 0, "results");
});

Deno.test("Search: country を変えると結果と通貨が変わる", async () => {
  const jp = await getJson(
    `${BASE}?term=kakeibo&country=jp&entity=software&limit=5`,
  );
  const us = await getJson(
    `${BASE}?term=kakeibo&country=us&entity=software&limit=5`,
  );
  ok(
    jp.body.results.length > 0 && us.body.results.length > 0,
    "どちらも結果がある",
  );
  const jpIds = jp.body.results.map((r: any) => r.trackId).join(",");
  const usIds = us.body.results.map((r: any) => r.trackId).join(",");
  ok(jpIds !== usIds, "ストアフロントで結果が異なる");
});

Deno.test("Search: 結果 1 件には 40 種類以上のフィールドがある（主要どころの型を固定）", async () => {
  const { body } = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=jp&entity=software&limit=1`,
  );
  const r = body.results[0];
  ok(Object.keys(r).length >= 40, `フィールド数: ${Object.keys(r).length}`);
  const types: Record<string, string> = {
    trackId: "number",
    bundleId: "string",
    trackName: "string",
    artistName: "string",
    sellerName: "string",
    artworkUrl512: "string",
    artworkUrl100: "string",
    primaryGenreName: "string",
    description: "string",
    version: "string",
    averageUserRating: "number",
    userRatingCount: "number",
    price: "number",
    currency: "string",
    formattedPrice: "string",
    trackViewUrl: "string",
    currentVersionReleaseDate: "string",
    releaseNotes: "string",
    minimumOsVersion: "string",
    fileSizeBytes: "string",
    contentAdvisoryRating: "string",
  };
  for (const [field, type] of Object.entries(types)) {
    eq(typeof r[field], type, `${field} の型`);
  }
  ok(
    Array.isArray(r.screenshotUrls) && r.screenshotUrls.length > 0,
    "screenshotUrls",
  );
  ok(Array.isArray(r.ipadScreenshotUrls), "ipadScreenshotUrls");
  ok(Array.isArray(r.languageCodesISO2A), "languageCodesISO2A");
  ok(
    r.averageUserRating >= 1 && r.averageUserRating <= 5,
    `averageUserRating: ${r.averageUserRating}`,
  );
  ok(r.userRatingCount > 0, "userRatingCount");
  ok(
    r.fileSizeBytes !== "" && Number.isFinite(Number(r.fileSizeBytes)),
    "fileSizeBytes は数値文字列",
  );
});

Deno.test("Search: 同じ検索でもストアフロントごとに通貨記号が変わる", async () => {
  const jp = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=jp&entity=software&limit=50`,
  );
  const us = await getJson(
    `${BASE}?term=${
      encodeURIComponent(TERM)
    }&country=us&entity=software&limit=50`,
  );
  const jpFree = jp.body.results.find((r: any) => r.price === 0);
  const usFree = us.body.results.find((r: any) => r.price === 0);
  ok(jpFree && usFree, "無料アプリが両方にある");
  eq(jpFree.currency, "JPY", "jp の通貨");
  eq(usFree.currency, "USD", "us の通貨");
  ok(
    jpFree.formattedPrice !== usFree.formattedPrice ||
      jpFree.currency !== usFree.currency,
    "表示価格が異なる",
  );
});

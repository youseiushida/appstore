// deno-lint-ignore-file no-explicit-any
/**
 * 実際の App Store から応答を取得し、テスト用の fixture として保存する。
 *
 *   deno run --allow-read --allow-write --allow-net tools/capture_fixtures.ts
 *
 * fixture の形:
 *   { name, face: "itunes" | "apps", pathPattern, params, status, contentType, body }
 *
 * - `pathPattern` はリクエストのパスに対する正規表現（例: limit の値を問わない）
 * - `params` はクエリの必須サブセット（例: { term, country, entity }）
 * - `body` は取得した生のテキスト
 *
 * ■ 出力前の秘匿化
 *   - 商品ページ: `userTokenHash` を空にする（セッション由来の値）
 *   - レビュー RSS: 第三者の投稿者名・タイトル・本文を仮名化する
 *   - Cookie / 認証ヘッダは元々送らないため含まれない
 */

const UA = "appstore-js/0.1.0 (+https://github.com/youseiushida/appstore)";
const FIXTURE_DIR = new URL("../test/fixtures/", import.meta.url);

/** 日本語ストアの家計簿アプリ（無料・レビュー多数） */
const FREE_APP_ID = "1059224316";
const FREE_BUNDLE_ID = "com.hapihapi.money";
/** 日本語ストアの有料アプリ */
const PAID_APP_ID = "6757778100";
/** 日米どちらでも配信されているアプリ */
const GLOBAL_APP_ID = "6448311069";
/** レビューが 0 件のアプリ */
const NO_REVIEW_APP_ID = "6787969363";
const MISSING_APP_ID = "999999999999999";

const SAMPLE_TITLE = "サンプルレビュータイトル";
const SAMPLE_BODY =
  "サンプルレビュー本文です。実際の投稿者の名前・タイトル・本文は再配布を避けるため匿名化しています。" +
  "この fixture では、件数・星の数・日時・バージョンといった構造だけを検証します。";

const authorMap = new Map<string, string>();

function pseudonym(original: string): string {
  if (!authorMap.has(original)) {
    authorMap.set(original, `reviewer-${authorMap.size + 1}`);
  }
  return authorMap.get(original) as string;
}

interface Target {
  name: string;
  face: "itunes" | "apps";
  url: string;
  pathPattern: string;
  params?: Record<string, string>;
  sanitize?: (body: string, status: number) => string;
}

/** 商品ページのセッション由来トークンを落とす。 */
function sanitizePage(body: string): string {
  return body.replace(/"userTokenHash":"[^"]*"/g, '"userTokenHash":""');
}

/** レビュー RSS の第三者情報を仮名化する。 */
function sanitizeReviews(body: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const entry = parsed?.feed?.entry;
  const entries = entry === undefined
    ? []
    : Array.isArray(entry)
    ? entry
    : [entry];
  for (const item of entries) {
    const name = item?.author?.name?.label;
    if (typeof name === "string") item.author.name.label = pseudonym(name);
    if (typeof item?.title?.label === "string") item.title.label = SAMPLE_TITLE;
    if (typeof item?.content?.label === "string") {
      item.content.label = SAMPLE_BODY;
    }
  }
  return JSON.stringify(parsed);
}

const targets: Target[] = [
  // ── iTunes Lookup API ─────────────────────────────────────
  {
    name: "lookup_jp_free",
    face: "itunes",
    url: `https://itunes.apple.com/lookup?id=${FREE_APP_ID}&country=jp`,
    pathPattern: "^/lookup$",
    params: { id: FREE_APP_ID },
  },
  {
    name: "lookup_jp_paid",
    face: "itunes",
    url: `https://itunes.apple.com/lookup?id=${PAID_APP_ID}&country=jp`,
    pathPattern: "^/lookup$",
    params: { id: PAID_APP_ID },
  },
  {
    name: "lookup_us_global",
    face: "itunes",
    url: `https://itunes.apple.com/lookup?id=${GLOBAL_APP_ID}&country=us`,
    pathPattern: "^/lookup$",
    params: { id: GLOBAL_APP_ID },
  },
  {
    name: "lookup_by_bundle_id",
    face: "itunes",
    url: `https://itunes.apple.com/lookup?bundleId=${
      encodeURIComponent(FREE_BUNDLE_ID)
    }&country=jp`,
    pathPattern: "^/lookup$",
    params: { bundleId: FREE_BUNDLE_ID },
  },
  {
    name: "lookup_not_found",
    face: "itunes",
    url: `https://itunes.apple.com/lookup?id=${MISSING_APP_ID}&country=jp`,
    pathPattern: "^/lookup$",
    params: { id: MISSING_APP_ID },
  },
  // ── iTunes Search API ─────────────────────────────────────
  {
    name: "search_kakeibo_jp",
    face: "itunes",
    url:
      "https://itunes.apple.com/search?term=%E5%AE%B6%E8%A8%88%E7%B0%BF&country=jp&entity=software&limit=5",
    pathPattern: "^/search$",
    params: { term: "家計簿", country: "jp", entity: "software" },
  },
  {
    name: "search_facebook_us",
    face: "itunes",
    url:
      "https://itunes.apple.com/search?term=facebook&country=us&entity=software&limit=5",
    pathPattern: "^/search$",
    params: { term: "facebook", country: "us", entity: "software" },
  },
  {
    name: "search_no_hits",
    face: "itunes",
    url:
      "https://itunes.apple.com/search?term=zzzzqqqxxyy&country=jp&entity=software&limit=5",
    pathPattern: "^/search$",
    params: { term: "zzzzqqqxxyy", country: "jp", entity: "software" },
  },
  // ── 商品ページ ────────────────────────────────────────────
  {
    name: "page_jp_free",
    face: "apps",
    url: `https://apps.apple.com/jp/app/id${FREE_APP_ID}`,
    pathPattern: `^/jp/app/id${FREE_APP_ID}$`,
    sanitize: sanitizePage,
  },
  {
    name: "page_jp_paid",
    face: "apps",
    url: `https://apps.apple.com/jp/app/id${PAID_APP_ID}`,
    pathPattern: `^/jp/app/id${PAID_APP_ID}$`,
    sanitize: sanitizePage,
  },
  {
    name: "page_not_found",
    face: "apps",
    url: `https://apps.apple.com/us/app/id${FREE_APP_ID}`,
    pathPattern: `^/us/app/id${FREE_APP_ID}$`,
    sanitize: sanitizePage,
  },
  // ── 公開レビュー RSS ───────────────────────────────────────
  {
    name: "reviews_most_recent",
    face: "itunes",
    url:
      `https://itunes.apple.com/jp/rss/customerreviews/page=1/id=${FREE_APP_ID}/sortBy=mostRecent/json`,
    pathPattern:
      `^/jp/rss/customerreviews/page=1/id=${FREE_APP_ID}/sortBy=mostRecent/json$`,
    sanitize: sanitizeReviews,
  },
  {
    name: "reviews_most_helpful",
    face: "itunes",
    url:
      `https://itunes.apple.com/jp/rss/customerreviews/page=1/id=${FREE_APP_ID}/sortBy=mostHelpful/json`,
    pathPattern:
      `^/jp/rss/customerreviews/page=1/id=${FREE_APP_ID}/sortBy=mostHelpful/json$`,
    sanitize: sanitizeReviews,
  },
  {
    name: "reviews_empty",
    face: "itunes",
    url:
      `https://itunes.apple.com/jp/rss/customerreviews/page=1/id=${NO_REVIEW_APP_ID}/sortBy=mostRecent/json`,
    pathPattern:
      `^/jp/rss/customerreviews/page=1/id=${NO_REVIEW_APP_ID}/sortBy=mostRecent/json$`,
    sanitize: sanitizeReviews,
  },
  {
    name: "reviews_page_out_of_range",
    face: "itunes",
    url:
      `https://itunes.apple.com/jp/rss/customerreviews/page=11/id=${FREE_APP_ID}/sortBy=mostRecent/json`,
    pathPattern:
      `^/jp/rss/customerreviews/page=11/id=${FREE_APP_ID}/sortBy=mostRecent/json$`,
  },
  // ── ランキング RSS ─────────────────────────────────────────
  {
    name: "charts_top_free",
    face: "itunes",
    url: "https://itunes.apple.com/jp/rss/topfreeapplications/limit=5/json",
    pathPattern: "^/jp/rss/topfreeapplications/limit=\\d+/json$",
  },
  {
    name: "charts_top_paid",
    face: "itunes",
    url: "https://itunes.apple.com/jp/rss/toppaidapplications/limit=5/json",
    pathPattern: "^/jp/rss/toppaidapplications/limit=\\d+/json$",
  },
  {
    name: "charts_top_grossing",
    face: "itunes",
    url: "https://itunes.apple.com/jp/rss/topgrossingapplications/limit=5/json",
    pathPattern: "^/jp/rss/topgrossingapplications/limit=\\d+/json$",
  },
  {
    name: "charts_new",
    face: "itunes",
    url: "https://itunes.apple.com/jp/rss/newapplications/limit=5/json",
    pathPattern: "^/jp/rss/newapplications/limit=\\d+/json$",
  },
  {
    name: "charts_top_free_education",
    face: "itunes",
    url:
      "https://itunes.apple.com/jp/rss/topfreeapplications/limit=5/genre=6017/json",
    pathPattern: "^/jp/rss/topfreeapplications/limit=\\d+/genre=6017/json$",
  },
];

await Deno.mkdir(FIXTURE_DIR, { recursive: true });

const written: string[] = [];
for (const target of targets) {
  const response = await fetch(target.url, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
  });
  const raw = await response.text();
  const body = target.sanitize ? target.sanitize(raw, response.status) : raw;
  const fixture = {
    name: target.name,
    face: target.face,
    pathPattern: target.pathPattern,
    params: target.params ?? {},
    status: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
  await Deno.writeTextFile(
    new URL(`${target.name}.json`, FIXTURE_DIR),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  written.push(
    `${target.name} (${
      (body.length / 1024).toFixed(1)
    }KB, status=${fixture.status})`,
  );
}

console.log(`fixtures: ${written.length} 件 -> test/fixtures/`);
for (const line of written) console.log(`  - ${line}`);
console.log(
  `秘匿化: レビューの投稿者 ${authorMap.size} 名を仮名化、商品ページの userTokenHash を除去`,
);

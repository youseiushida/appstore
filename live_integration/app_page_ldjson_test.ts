// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ⑤── 商品ページ HTML（schema.org の ld+json）
 *
 * 目的:
 *   商品ページには <script type="application/ld+json"> で構造化データが埋まっている。
 *   ここから「アプリ名・説明・価格・評価・開発者」を DOM パーサ無しで取り出せることを固定する。
 *   iTunes API と突き合わせて、同じ値が取れることも確認する。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/app_page_ldjson_test.ts
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const APP_ID = "1059224316";
const PAGE = (storefront: string, suffix = "") =>
  `https://apps.apple.com/${storefront}/app/id${APP_ID}${suffix}`;

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

async function fetchPage(
  url: string,
): Promise<{ status: number; html: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
  });
  return { status: response.status, html: await response.text() };
}

/** 商品ページに埋まっている ld+json を、@type で選んで取り出す（DOM パーサ不要） */
function ldJsonByType(html: string, type: string): any | null {
  const scripts = html.matchAll(
    /<script([^>]*type="application\/ld\+json"[^>]*)>([\s\S]*?)<\/script>/g,
  );
  for (const match of scripts) {
    const raw = match[2] as string | undefined;
    if (raw === undefined) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.["@type"] === type) return parsed;
    } catch {
      // 壊れたブロックは無視して次を見る
    }
  }
  return null;
}

Deno.test("ページ: 200 で返り、ld+json を素の文字列処理で取り出せる", async () => {
  const { status, html } = await fetchPage(PAGE("jp"));
  eq(status, 200, "HTTP ステータス");
  ok(html.length > 200_000, `HTML のサイズ: ${html.length}`);
  ok(html.includes("application/ld+json"), "ld+json が埋まっている");
  const app = ldJsonByType(html, "SoftwareApplication");
  ok(app, "SoftwareApplication の ld+json がある");
  // 登場する ld+json の種類（Organization / SoftwareApplication / BreadcrumbList）
  const types = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ]
    .map((m) => {
      try {
        return JSON.parse(m[1] ?? "")["@type"];
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  ok(types.includes("Organization"), `埋まっている @type: ${types.join(",")}`);
});

Deno.test("ページ: SoftwareApplication のフィールド（名前・説明・価格・評価・開発者）", async () => {
  const { html } = await fetchPage(PAGE("jp"));
  const app = ldJsonByType(html, "SoftwareApplication");
  ok(app, "SoftwareApplication がある");
  eq(app["@context"], "https://schema.org", "@context");
  eq(typeof app.name, "string", "name");
  eq(typeof app.description, "string", "description");
  ok(app.description.length > 50, "description は本文が入っている");
  ok(String(app.image).startsWith("https://"), "image は URL");
  eq(typeof app.operatingSystem, "string", "operatingSystem");
  eq(typeof app.availableOnDevice, "string", "availableOnDevice");
  eq(app.applicationCategory, "FinanceApplication", "applicationCategory");
  eq(app.offers["@type"], "Offer", "offers の型");
  eq(typeof app.offers.price, "number", "offers.price");
  eq(typeof app.offers.priceCurrency, "string", "offers.priceCurrency");
  eq(app.aggregateRating["@type"], "AggregateRating", "aggregateRating の型");
  eq(typeof app.aggregateRating.ratingValue, "number", "ratingValue");
  eq(typeof app.aggregateRating.reviewCount, "number", "reviewCount");
  eq(app.aggregateRating.bestRating, "5", "bestRating は文字列の 5");
  eq(app.aggregateRating.worstRating, "1", "worstRating は文字列の 1");
  eq(app.author["@type"], "Organization", "author の型");
  eq(typeof app.author.name, "string", "author.name（開発者名）");
  ok(Array.isArray(app.keywords) && app.keywords.length > 0, "keywords");
});

Deno.test("ページ: ld+json と iTunes API の値は一致する（名前・評価・件数）", async () => {
  const { html } = await fetchPage(PAGE("jp"));
  const app = ldJsonByType(html, "SoftwareApplication");
  const lookup = await (await fetch(
    `https://itunes.apple.com/lookup?id=${APP_ID}&country=jp`,
    {
      headers: { "user-agent": UA },
    },
  )).json();
  const api = lookup.results[0];
  eq(app.name, api.trackName, "アプリ名が一致する");
  eq(app.author.name, api.artistName, "開発者名が一致する");
  eq(app.offers.priceCurrency, api.currency, "通貨が一致する");
  ok(
    Math.abs(app.aggregateRating.ratingValue - api.averageUserRating) < 0.15,
    "平均評価が近い",
  );
  ok(
    Math.abs(app.aggregateRating.reviewCount - api.userRatingCount) /
        api.userRatingCount < 0.01,
    `評価件数が近い（ページ ${app.aggregateRating.reviewCount} / API ${api.userRatingCount}）`,
  );
});

Deno.test("ページ: ?l= で言語が変わる（intent に言語が入る）", async () => {
  const ja = await fetchPage(PAGE("jp"));
  const en = await fetchPage(PAGE("jp", "?l=en"));
  eq(en.status, 200, "英語ページも 200");
  const intentOf = (html: string): any => {
    const marker = html.indexOf('id="serialized-server-data"');
    const open = html.indexOf(">", marker) + 1;
    const close = html.indexOf("</script>", open);
    return JSON.parse(html.slice(open, close)).data["0"].intent;
  };
  eq(intentOf(ja.html).storefront, "jp", "ストアフロント");
  eq(intentOf(ja.html).isDefaultLanguage, true, "既定言語（ja）");
  eq(intentOf(en.html).language, "en-US", "?l=en の言語");
  eq(intentOf(en.html).isDefaultLanguage, false, "既定言語ではない");
  ok(
    ldJsonByType(ja.html, "SoftwareApplication").name !==
      ldJsonByType(en.html, "SoftwareApplication").name,
    "アプリ名も言語で変わる",
  );
});

Deno.test("ページ: 配信していないストアフロントは 404 になる", async () => {
  const jp = await fetchPage(PAGE("jp"));
  eq(jp.status, 200, "jp は 200");
  const us = await fetchPage(PAGE("us"));
  // このアプリは us に無い（将来配信されたら 200 になるため、形だけを固定する）
  ok([200, 404].includes(us.status), `us のステータス: ${us.status}`);
  if (us.status === 404) {
    eq(
      ldJsonByType(us.html, "SoftwareApplication"),
      null,
      "404 ページにアプリの ld+json は無い",
    );
  }
});

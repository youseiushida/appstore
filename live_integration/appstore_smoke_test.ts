// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ⑨── 4 つの情報源をつないだ通し確認
 *
 * 目的:
 *   「薄いライブラリ」が実際に組み立てられるかを、検索 → 照会 → 商品ページ → レビュー
 *   の順に通して確かめる。すべて素の fetch と JSON だけで完結し、
 *   ブラウザ・DOM パーサ・重量級ライブラリを一切使わない。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/appstore_smoke_test.ts
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const SEARCH_TERM = "家計簿";
const COUNTRY = "jp";

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

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  ok(response.ok, `${url} が HTTP ${response.status}`);
  return await response.json();
}

function scriptJson(html: string, id: string): any {
  const marker = html.indexOf(`id="${id}"`);
  ok(marker >= 0, `id="${id}" の script が無い`);
  const open = html.indexOf(">", marker) + 1;
  const close = html.indexOf("</script>", open);
  return JSON.parse(html.slice(open, close));
}

function ldJsonByType(html: string, type: string): any | null {
  for (
    const match of html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )
  ) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      if (parsed?.["@type"] === type) return parsed;
    } catch {
      // 壊れていれば次
    }
  }
  return null;
}

Deno.test("通し: 検索 → 照会 → 商品ページ → レビュー が 4 つの情報源で一致する", async () => {
  // 1. 検索（iTunes Search API）
  const search = await getJson(
    `https://itunes.apple.com/search?term=${
      encodeURIComponent(SEARCH_TERM)
    }&country=${COUNTRY}&entity=software&limit=5`,
  );
  ok(search.resultCount > 0, "検索結果がある");
  const hit = search.results[0];
  const trackId = String(hit.trackId);
  ok(/^\d+$/.test(trackId), `trackId: ${trackId}`);

  // 2. 照会（iTunes Lookup API）
  const lookup = await getJson(
    `https://itunes.apple.com/lookup?id=${trackId}&country=${COUNTRY}`,
  );
  eq(lookup.resultCount, 1, "lookup の件数");
  const app = lookup.results[0];
  eq(app.trackId, hit.trackId, "検索と照会の trackId が一致");
  eq(app.bundleId, hit.bundleId, "bundleId が一致");

  // 3. 商品ページ（HTML 2 種類の埋め込みデータ）
  const html =
    await (await fetch(`https://apps.apple.com/${COUNTRY}/app/id${trackId}`, {
      headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
    })).text();
  const payload = scriptJson(html, "serialized-server-data").data["0"].data;
  const card = ldJsonByType(html, "SoftwareApplication");
  ok(card, "ld+json の SoftwareApplication がある");
  eq(String(payload.lockup.adamId), trackId, "ページの adamId が一致");
  eq(payload.lockup.bundleId, app.bundleId, "ページの bundleId が一致");
  eq(card.name, app.trackName, "ページの名前と API の名前が一致");
  eq(card.author.name, app.artistName, "開発者名が一致");

  // 評価は 3 か所（API / ld+json / ページデータ）で整合する
  const ratings = payload.shelfMapping.productRatings.items[0];
  ok(
    Math.abs(ratings.ratingAverage - app.averageUserRating) < 0.15,
    "ページと API の平均評価が近い",
  );
  ok(
    Math.abs(ratings.totalNumberOfRatings - app.userRatingCount) /
        app.userRatingCount < 0.01,
    `評価件数が近い（ページ ${ratings.totalNumberOfRatings} / API ${app.userRatingCount}）`,
  );
  ok(
    Math.abs(card.aggregateRating.ratingValue - app.averageUserRating) < 0.15,
    "ld+json の評価も近い",
  );

  // iTunes API に無い情報がページから取れる
  eq(
    typeof payload.lockup.subtitle,
    "string",
    "サブタイトルはページにしか無い",
  );
  eq(
    typeof payload.shelfMapping.description.items[0].paragraph.text,
    "string",
    "説明文",
  );
  ok(
    payload.shelfMapping["product_media_phone_"].items.length > 0,
    "スクリーンショット",
  );
  ok(payload.shelfMapping.privacyTypes.items.length > 0, "プライバシー表示");

  // 4. レビュー（公開 RSS）
  const rss = await getJson(
    `https://itunes.apple.com/${COUNTRY}/rss/customerreviews/id=${trackId}/sortBy=mostRecent/json`,
  );
  const entry = Array.isArray(rss.feed.entry)
    ? rss.feed.entry[0]
    : rss.feed.entry;
  ok(entry, "レビューが 1 件以上ある");
  ok(/^\d+$/.test(entry.id.label), `レビュー ID: ${entry.id.label}`);
  ok(
    Number(entry["im:rating"].label) >= 1 &&
      Number(entry["im:rating"].label) <= 5,
    "星は 1〜5",
  );
  ok(!Number.isNaN(Date.parse(entry.updated.label)), "更新日がパースできる");
});

Deno.test("通し: 4 つの情報源はすべて同じストアフロント（country）を指定して取れる", async () => {
  for (const country of ["jp", "us"]) {
    const search = await getJson(
      `https://itunes.apple.com/search?term=facebook&country=${country}&entity=software&limit=1`,
    );
    ok(search.resultCount > 0, `${country} の検索`);
    const id = String(search.results[0].trackId);
    const lookup = await getJson(
      `https://itunes.apple.com/lookup?id=${id}&country=${country}`,
    );
    eq(lookup.resultCount, 1, `${country} の lookup`);
    const rss = await getJson(
      `https://itunes.apple.com/${country}/rss/customerreviews/id=${id}/sortBy=mostRecent/json`,
    );
    ok(rss.feed !== undefined, `${country} の RSS`);
    const html =
      await (await fetch(`https://apps.apple.com/${country}/app/id${id}`, {
        headers: { "user-agent": UA },
      })).text();
    const intent = scriptJson(html, "serialized-server-data").data["0"].intent;
    eq(intent.storefront, country, `${country} のページのストアフロント`);
  }
});

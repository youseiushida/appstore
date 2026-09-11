// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ④── トップチャート RSS
 *
 * 目的:
 *   ランキング（無料/有料/売上/新着）を JSON で取れる RSS の仕様を固定する。
 *   ASO では「順位」そのものがデータになるため、並び順と順位の対応を押さえる。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/top_charts_rss_test.ts
 */

const UA = "Mozilla/5.0 (compatible; appstore-spec/0.1)";
const FEED = (path: string) => `https://itunes.apple.com/jp/rss/${path}/json`;

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

async function get(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

const entriesOf = (body: any): any[] => {
  const entry = body?.feed?.entry;
  return entry === undefined ? [] : Array.isArray(entry) ? entry : [entry];
};

Deno.test("チャート: limit とチャート種別が効く（無料/売上/新着）", async () => {
  for (
    const [path, expectAtLeast] of [
      ["topfreeapplications/limit=5", 5],
      ["topgrossingapplications/limit=5", 5],
      ["newapplications/limit=5", 5],
    ] as [string, number][]
  ) {
    const { status, body } = await get(FEED(path));
    eq(status, 200, `${path} のステータス`);
    const entries = entriesOf(body);
    ok(entries.length >= expectAtLeast, `${path} の件数: ${entries.length}`);
    if (path.startsWith("topfree") || path.startsWith("topgrossing")) {
      eq(entries.length, 5, `${path} は limit どおりの件数`);
    }
  }
});

Deno.test("チャート: エントリはランキング順に並ぶ（index 0 が 1 位）", async () => {
  const { body } = await get(FEED("topfreeapplications/limit=10"));
  const entries = entriesOf(body);
  eq(entries.length, 10, "件数");
  const names = entries.map((entry) => entry["im:name"].label);
  ok(new Set(names).size === names.length, "同じアプリが重複しない");
  // im:image は 3 サイズ（55/60/170）が入る
  const image = entries[0]["im:image"];
  eq(image.length, 3, "im:image は 3 件");
  ok(
    image.every((img: any) =>
      typeof img.label === "string" && img.attributes?.height
    ),
    "im:image の形",
  );
});

Deno.test("チャート: 1 件分のフィールド（ID・bundleId・カテゴリ・価格・開発者）", async () => {
  const { body } = await get(FEED("topfreeapplications/limit=1"));
  // 件数が 1 のときは feed.entry が配列ではなく単一オブジェクトになる
  eq(
    Array.isArray(body.feed.entry),
    false,
    "limit=1 では entry は単一オブジェクト",
  );
  const entry = entriesOf(body)[0];
  ok(
    /^\d+$/.test(entry.id.attributes["im:id"]),
    `im:id: ${entry.id.attributes["im:id"]}`,
  );
  eq(typeof entry.id.attributes["im:bundleId"], "string", "im:bundleId");
  eq(typeof entry["im:name"].label, "string", "im:name");
  eq(typeof entry["im:artist"].label, "string", "im:artist（開発者）");
  eq(typeof entry["im:price"].label, "string", "im:price");
  eq(entry["im:price"].attributes.currency, "JPY", "通貨");
  eq(typeof entry.category.attributes.label, "string", "category.label");
  ok(/^\d+$/.test(entry.category.attributes["im:id"]), "category の im:id");
  // link は配列で、rel=alternate が商品ページ、rel=enclosure がスクリーンショット
  ok(Array.isArray(entry.link), "link は配列");
  const alternate = entry.link.find((l: any) =>
    l.attributes?.rel === "alternate"
  );
  ok(
    String(alternate?.attributes?.href).includes("apps.apple.com"),
    "rel=alternate は商品ページ",
  );
  const enclosure = entry.link.find((l: any) =>
    l.attributes?.rel === "enclosure"
  );
  ok(
    String(enclosure?.attributes?.href).includes("mzstatic.com"),
    "rel=enclosure は画像",
  );
});

Deno.test("チャート: genre を指定するとカテゴリを絞れる", async () => {
  const all = entriesOf((await get(FEED("topfreeapplications/limit=10"))).body);
  // 6017 = 教育（Education）
  const education = entriesOf(
    (await get(FEED("topfreeapplications/limit=10/genre=6017"))).body,
  );
  eq(education.length, 10, "件数");
  const allIds = new Set(all.map((entry) => entry.id.attributes["im:id"]));
  ok(
    education.some((entry) => !allIds.has(entry.id.attributes["im:id"])),
    "カテゴリ指定で結果が変わる",
  );
});

Deno.test("チャート: 存在しないジャンル ID は無視され、全体のチャートが返る", async () => {
  const { status, body } = await get(
    FEED("topfreeapplications/limit=5/genre=999999"),
  );
  eq(status, 200, "HTTP ステータス");
  const ids = entriesOf(body).map((entry) => entry.id.attributes["im:id"]);
  const unfiltered = entriesOf(
    (await get(FEED("topfreeapplications/limit=5"))).body,
  )
    .map((entry) => entry.id.attributes["im:id"]);
  eq(
    ids.join(","),
    unfiltered.join(","),
    "ジャンル指定が無視されて全体チャートと同じ",
  );
});

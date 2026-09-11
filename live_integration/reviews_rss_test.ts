// deno-lint-ignore-file no-explicit-any
/**
 * App Store 仕様調査 ③── 公開レビュー RSS
 *
 * 目的:
 *   Apple が公開している customerreviews RSS の仕様を固定する。
 *   ページング（最大 10 ページ）・ソート・件数・1 件分のフィールド・
 *   異常系（存在しない ID、ページ超過）まで押さえる。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/reviews_rss_test.ts
 */

const UA = "Mozilla/5.0 (compatible; appstore-spec/0.1)";
const APP_ID = "1059224316"; // 日本語ストアの家計簿アプリ
const FEED = (query: string) =>
  `https://itunes.apple.com/jp/rss/customerreviews/${query}/json`;

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

async function get(
  url: string,
): Promise<
  { status: number; contentType: string | null; text: string; body: any }
> {
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
    text,
    body,
  };
}

const entriesOf = (body: any): any[] => {
  const entry = body?.feed?.entry;
  if (entry === undefined || entry === null) return [];
  return Array.isArray(entry) ? entry : [entry];
};

Deno.test("RSS: id + sortBy で最新レビューが取れる（feed のキーを固定）", async () => {
  const { status, body } = await get(FEED(`id=${APP_ID}/sortBy=mostRecent`));
  eq(status, 200, "HTTP ステータス");
  ok(body, "JSON として読める");
  eq(
    Object.keys(body.feed).sort().join(","),
    "author,entry,icon,id,link,rights,title,updated",
    "feed のキー集合",
  );
  eq(body.feed.author.name.label, "iTunes Store", "feed.author.name.label");
  ok(
    String(body.feed.id.label).includes(String(APP_ID)),
    "feed.id.label にアプリ ID が入る",
  );
});

Deno.test("RSS: 1 ページは最大 50 件で、1 件分のフィールドが固定している", async () => {
  const { body } = await get(FEED(`id=${APP_ID}/sortBy=mostRecent`));
  const entries = entriesOf(body);
  eq(entries.length, 50, "1 ページの件数");
  const entry = entries[0];
  eq(
    Object.keys(entry).sort().join(","),
    "author,content,id,im:contentType,im:rating,im:version,im:voteCount,im:voteSum,link,title,updated",
    "entry のキー集合",
  );
  // すべての値は { label: "..." } の形（RSS の JSON 表現）
  for (
    const key of [
      "id",
      "title",
      "content",
      "updated",
      "im:rating",
      "im:version",
      "im:voteSum",
      "im:voteCount",
    ]
  ) {
    eq(typeof entry[key]?.label, "string", `${key}.label は文字列`);
  }
  eq(typeof entry.author.name.label, "string", "author.name.label");
  eq(typeof entry.author.uri.label, "string", "author.uri.label");
  eq(
    entry.author.label,
    "",
    "author.label は空文字（名前は author.name.label に入る）",
  );
});

Deno.test("RSS: 評価は 1〜5 の文字列、日付は ISO8601、本文とタイトルは非空", async () => {
  const { body } = await get(FEED(`id=${APP_ID}/sortBy=mostRecent`));
  for (const entry of entriesOf(body)) {
    const rating = Number(entry["im:rating"].label);
    ok(
      Number.isInteger(rating) && rating >= 1 && rating <= 5,
      `im:rating: ${entry["im:rating"].label}`,
    );
    ok(
      /^\d{4}-\d{2}-\d{2}T/.test(entry.updated.label),
      `updated: ${entry.updated.label}`,
    );
    ok(
      !Number.isNaN(Date.parse(entry.updated.label)),
      "updated はパースできる",
    );
    ok(entry.content.label.length > 0, "content は空でない");
    ok(entry.title.label.length > 0, "title は空でない");
    ok(/^\d+$/.test(entry.id.label), `id は数字文字列: ${entry.id.label}`);
  }
});

Deno.test("RSS: sortBy=mostRecent は更新日の降順になっている", async () => {
  const { body } = await get(FEED(`id=${APP_ID}/sortBy=mostRecent`));
  const times = entriesOf(body).map((entry) => Date.parse(entry.updated.label));
  const sorted = [...times].sort((a, b) => b - a);
  eq(times.join(","), sorted.join(","), "更新日の降順");
});

Deno.test("RSS: sortBy=mostHelpful も同じ形で返る（並びだけが違う）", async () => {
  const { status, body } = await get(FEED(`id=${APP_ID}/sortBy=mostHelpful`));
  eq(status, 200, "HTTP ステータス");
  const entries = entriesOf(body);
  eq(entries.length, 50, "件数");
  const votes = entries.slice(0, 10).map((entry) =>
    Number(entry["im:voteSum"].label)
  );
  ok(
    votes.some((vote) => vote > 0),
    `参考になった票が付く: ${votes.join(",")}`,
  );
});

Deno.test("RSS: page は 1〜10 まで取れて、11 ページ目は 400 で打ち切られる", async () => {
  for (const page of [1, 2, 10]) {
    const { status, body } = await get(
      FEED(`page=${page}/id=${APP_ID}/sortBy=mostRecent`),
    );
    eq(status, 200, `page=${page} のステータス`);
    ok(entriesOf(body).length > 0, `page=${page} にレビューがある`);
  }
  const over = await get(FEED(`page=11/id=${APP_ID}/sortBy=mostRecent`));
  eq(over.status, 400, "11 ページ目は 400");
  ok(over.body === null, "JSON ではない");
  ok(
    over.text.includes("page depth is limited to 10"),
    `本文: ${over.text.slice(0, 60)}`,
  );
});

Deno.test("RSS: ページごとに内容が違う（同じレビューが繰り返されない）", async () => {
  const page1 = entriesOf(
    (await get(FEED(`page=1/id=${APP_ID}/sortBy=mostRecent`))).body,
  );
  const page2 = entriesOf(
    (await get(FEED(`page=2/id=${APP_ID}/sortBy=mostRecent`))).body,
  );
  const ids1 = new Set(page1.map((entry) => entry.id.label));
  eq(
    page2.filter((entry) => ids1.has(entry.id.label)).length,
    0,
    "1 ページ目と重複しない",
  );
});

Deno.test("RSS: 存在しないアプリ ID は feed はあるが entry が無い（200）", async () => {
  const { status, text, body } = await get(
    FEED(`id=999999999999999/sortBy=mostRecent`),
  );
  eq(status, 200, "HTTP ステータス");
  ok(body?.feed !== undefined, "feed は存在する");
  eq(entriesOf(body).length, 0, "entry は無い");
  ok(text.length > 100, "本文は空ではない");
});

Deno.test("RSS: page=0 は 500 で HTML 断片が返る（JSON ではない）", async () => {
  const { status, text, body } = await get(
    FEED(`page=0/id=${APP_ID}/sortBy=mostRecent`),
  );
  eq(status, 500, "HTTP ステータス");
  eq(body, null, "JSON ではない");
  ok(
    text.includes("Empty") || text.length < 30,
    `本文: ${JSON.stringify(text.slice(0, 40))}`,
  );
});

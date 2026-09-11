/**
 * App Store 仕様調査 ⑧── 内部 API（amp-api-edge）の扱い
 *
 * 目的:
 *   商品ページの serialized-server-data には、描画に使われた内部 API の URL
 *   （amp-api-edge ... /v1/catalog/{storefront}/apps/{id}...）が記録されている。
 *   これは「そのまま叩けるのか？」を確かめ、方針を固定する。
 *   結論: 認証ヘッダ（Bearer トークン）が必要で、素の fetch では 401 になる。
 *         → ライブラリは HTML（ld+json / serialized-server-data）から読む。
 *
 * 実行（このファイル単体で完結します）:
 *   deno test --allow-net live_integration/amp_api_test.ts
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const APP_ID = "1059224316";
const PAGE_URL = `https://apps.apple.com/jp/app/id${APP_ID}`;

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

async function pageHtml(): Promise<string> {
  return await (await fetch(PAGE_URL, {
    headers: { "user-agent": UA, "accept-language": "ja,en;q=0.9" },
  })).text();
}

/** ページに埋まっている内部 API の URL（pageUrl）を取り出す */
function pageApiUrl(html: string): string | null {
  const match = html.match(
    /https:\/\/amp-api-edge\.apps\.apple\.com\/v1\/catalog\/[^"\\]+/,
  );
  return match ? match[0].replace(/\\u0026/g, "&") : null;
}

Deno.test("内部API: ページに amp-api-edge の URL が記録されている", async () => {
  const html = await pageHtml();
  const url = pageApiUrl(html);
  ok(url, "pageUrl が見つかる");
  ok(
    url!.includes(`/v1/catalog/jp/apps/${APP_ID}`),
    `パスにアプリ ID が入る: ${url!.slice(0, 90)}`,
  );
  ok(url!.includes("platform=web"), "platform=web が付く");
  ok(url!.includes("extend="), "extend= で取得項目を指定している");
});

Deno.test("内部API: その URL を素の fetch で叩くと 401（トークン必須）", async () => {
  const html = await pageHtml();
  const url = pageApiUrl(html);
  ok(url, "pageUrl が見つかる");
  const plain = await fetch(url!, { headers: { "user-agent": UA } });
  eq(plain.status, 401, "ヘッダ無しの 401");
  eq((await plain.text()).length, 0, "本文は空");
  const browserish = await fetch(url!, {
    headers: {
      "user-agent": UA,
      "origin": "https://apps.apple.com",
      "referer": "https://apps.apple.com/",
      "accept": "application/json",
    },
  });
  eq(browserish.status, 401, "ブラウザ風ヘッダでも 401");
});

Deno.test("内部API: ページ HTML にはトークンが平文で置かれていない", async () => {
  const html = await pageHtml();
  for (const needle of ["media-api-token", "Bearer ", "authorization"]) {
    eq(html.includes(needle), false, `${needle} は HTML に含まれない`);
  }
  // したがって、内部 API を使うには別途トークン入手が必要になる（ライブラリでは扱わない）
});

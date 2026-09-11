import { AppStoreError } from "./errors.ts";
import {
  artworkUrl,
  asArray,
  asNumber,
  asString,
  at,
  toRelatedApp,
} from "./parse.ts";
import type {
  InAppPurchase,
  InformationItem,
  PrivacyLabel,
  RelatedApp,
  WhatsNew,
} from "./types.ts";

/** 商品ページから取り出した情報（iTunes API には無いもの）。 */
export interface PageSnapshot {
  subtitle: string | null;
  description: string | null;
  ratingAverage: number | null;
  ratingCount: number | null;
  /** [5★, 4★, 3★, 2★, 1★] */
  ratingBreakdown: [number, number, number, number, number] | null;
  whatsNew: WhatsNew | null;
  screenshots: string[];
  privacy: PrivacyLabel[];
  inAppPurchases: InAppPurchase[];
  relatedApps: RelatedApp[];
  developerApps: RelatedApp[];
  information: InformationItem[];
  raw: {
    ldJson: unknown | null;
    intent: unknown;
    lockup: unknown;
    shelfMapping: unknown;
  };
}

/** `<script ... id="...">...</script>` の中身を JSON として取り出す（DOM パーサ不要）。 */
export function extractScriptJson(html: string, id: string): unknown {
  const marker = html.indexOf(`id="${id}"`);
  if (marker < 0) {
    throw new AppStoreError(
      "parse",
      `商品ページに id="${id}" の script がありません`,
    );
  }
  const open = html.indexOf(">", marker);
  const close = html.indexOf("</script>", open);
  if (open < 0 || close < 0) {
    throw new AppStoreError(
      "parse",
      `id="${id}" の script の中身を切り出せません`,
    );
  }
  try {
    return JSON.parse(html.slice(open + 1, close));
  } catch (cause) {
    throw new AppStoreError(
      "parse",
      `id="${id}" の中身を JSON として解析できません`,
      { cause },
    );
  }
}

/** `<script type="application/ld+json">` の中から `@type` が一致するものを探す。 */
export function extractLdJson(html: string, type: string): unknown | null {
  for (
    const match of html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )
  ) {
    try {
      const parsed = JSON.parse(match[1] as string);
      if (at(parsed, "@type") === type) return parsed;
    } catch {
      // 壊れたブロックは無視して次を見る
    }
  }
  return null;
}

function toPrivacyLabels(shelf: unknown): PrivacyLabel[] {
  return asArray(at(shelf, "items")).map((item) => ({
    identifier: asString(at(item, "identifier")) ?? "",
    title: asString(at(item, "title")) ?? "",
    detail: asString(at(item, "detail")),
    categories: asArray(at(item, "categories"))
      .map((category) => asString(at(category, "title")))
      .filter((title): title is string => title !== null),
  }));
}

/** 情報欄。値は `items[0].text` か、`items[0].textPairs`（アプリ内購入など）から作る。 */
function toInformation(shelf: unknown): InformationItem[] {
  return asArray(at(shelf, "items")).map((item) => {
    const first = asArray(at(item, "items"))[0];
    const text = asString(at(first, "text"));
    const pairs = asArray(at(first, "textPairs"))
      .map((pair) =>
        asArray(pair).map((value) => asString(value) ?? "").join(" ")
      )
      .filter((line) => line.length > 0);
    return {
      title: asString(at(item, "title")) ?? "",
      value: text ?? pairs.join(" / "),
    };
  });
}

/**
 * アプリ内購入の一覧。言語によって情報欄の見出しが変わるため、
 * 「textPairs を持つ注釈」を言語非依存で探す。
 */
function toInAppPurchases(shelf: unknown): InAppPurchase[] {
  for (const item of asArray(at(shelf, "items"))) {
    const first = asArray(at(item, "items"))[0];
    const pairs = asArray(at(first, "textPairs"));
    if (pairs.length === 0) continue;
    return pairs.map((pair) => {
      const values = asArray(pair);
      return {
        name: asString(values[0]) ?? "",
        price: asString(values[1]) ?? "",
      };
    });
  }
  return [];
}

/** 商品ページ HTML から、iTunes API に無い情報を取り出す。 */
export function pageSnapshot(html: string, storefront: string): PageSnapshot {
  const root = extractScriptJson(html, "serialized-server-data");
  const node = at(at(root, "data"), "0");
  const payload = at(node, "data");
  if (payload === undefined || payload === null) {
    throw new AppStoreError("parse", "商品ページの data が想定外の形です");
  }
  const shelves = at(payload, "shelfMapping");
  const lockup = at(payload, "lockup");

  const ratings = asArray(at(at(shelves, "productRatings"), "items"))[0];
  const counts = asArray(at(ratings, "ratingCounts"));
  const ratingBreakdown =
    counts.length === 5 && counts.every((count) => typeof count === "number")
      ? (counts as [number, number, number, number, number])
      : null;

  // スクリーンショットは product_media_* シェルフ（iPhone / iPad など）から集める
  const screenshots: string[] = [];
  for (const key of Object.keys(shelves ?? {})) {
    if (!key.startsWith("product_media_")) continue;
    for (const item of asArray(at(at(shelves, key), "items"))) {
      const url = artworkUrl(at(item, "screenshot"));
      if (url) screenshots.push(url);
    }
  }

  const version = asArray(at(at(shelves, "mostRecentVersion"), "items"))[0];
  const versionDate = asString(at(version, "secondarySubtitle"));
  const whatsNew: WhatsNew | null = version === undefined ? null : {
    text: asString(at(version, "text")) ?? "",
    versionLabel: asString(at(version, "primarySubtitle")),
    date: versionDate !== null && !Number.isNaN(Date.parse(versionDate))
      ? new Date(versionDate)
      : null,
  };

  const description = asString(
    at(
      at(asArray(at(at(shelves, "description"), "items"))[0], "paragraph"),
      "text",
    ),
  );

  return {
    subtitle: asString(at(lockup, "subtitle")),
    description,
    ratingAverage: asNumber(at(ratings, "ratingAverage")),
    ratingCount: asNumber(at(ratings, "totalNumberOfRatings")),
    ratingBreakdown,
    whatsNew,
    screenshots: [...new Set(screenshots)],
    privacy: toPrivacyLabels(at(shelves, "privacyTypes")),
    inAppPurchases: toInAppPurchases(at(shelves, "information")),
    relatedApps: asArray(at(at(shelves, "similarItems"), "items"))
      .map((item) => toRelatedApp(item, storefront)),
    developerApps: asArray(at(at(shelves, "moreByDeveloper"), "items"))
      .map((item) => toRelatedApp(item, storefront)),
    information: toInformation(at(shelves, "information")),
    raw: {
      ldJson: extractLdJson(html, "SoftwareApplication"),
      intent: at(node, "intent"),
      lockup,
      shelfMapping: shelves,
    },
  };
}

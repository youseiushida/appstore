import type { ChartPrice, RelatedApp } from "./types.ts";

/** 配列・単一オブジェクト・undefined のどれでも配列に正規化する（RSS は 1 件だと単一で返る）。 */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function at(value: unknown, key: string | number): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Record<string | number, unknown>)[key];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** RSS の `{ label: "..." }` から文字列を取り出す。 */
export function label(value: unknown): string | null {
  return asString(at(value, "label"));
}

/**
 * 商品ページの画像は `.../{w}x{h}{c}.{f}` というテンプレートで返る。
 * Apple の Web ページと同じ規則（crop は bb、形式は variants[0].format）で実 URL にする。
 */
export function expandArtworkTemplate(
  template: string,
  width: number,
  height: number,
  format?: string | null,
): string {
  const resolvedFormat = format && format.length > 0 ? format : "jpg";
  return template
    .replace("{w}", String(width))
    .replace("{h}", String(height))
    .replace("{c}", "bb")
    .replace("{f}", resolvedFormat);
}

/** Artwork オブジェクト（商品ページ）から実 URL を作る。 */
export function artworkUrl(artwork: unknown): string | null {
  const template = asString(at(artwork, "template"));
  if (!template) return null;
  const width = asNumber(at(artwork, "width")) ?? 0;
  const height = asNumber(at(artwork, "height")) ?? 0;
  const format =
    asString(at(at(asArray(at(artwork, "variants"))[0], "format"), "label")) ??
      asString(at(asArray(at(artwork, "variants"))[0], "format"));
  if (!template.includes("{")) return template;
  return expandArtworkTemplate(template, width, height, format);
}

/** 商品ページの Lockup（関連アプリ・同開発者の他アプリ）を正規化する。 */
export function toRelatedApp(lockup: unknown, storefront: string): RelatedApp {
  const adamId = asString(at(lockup, "adamId")) ??
    String(at(lockup, "adamId") ?? "");
  const offer = at(lockup, "offerDisplayProperties");
  const priceLabel = asString(at(at(offer, "titles"), "standard"));
  const price: ChartPrice | null = priceLabel
    ? { formatted: priceLabel, currency: null }
    : null;
  return {
    id: adamId,
    bundleId: asString(at(lockup, "bundleId")) ?? "",
    name: asString(at(lockup, "title")) ?? "",
    icon: artworkUrl(at(lockup, "icon")),
    rating: asNumber(at(lockup, "rating")),
    ratingCount: asNumber(at(lockup, "ratingCount")),
    price,
    url: adamId ? `https://apps.apple.com/${storefront}/app/id${adamId}` : "",
  };
}

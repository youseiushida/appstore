import { asArray, asString, at, label } from "./parse.ts";
import type { ChartEntry } from "./types.ts";

const CHART_PATHS = {
  topFree: "topfreeapplications",
  topPaid: "toppaidapplications",
  topGrossing: "topgrossingapplications",
  new: "newapplications",
} as const;

export type ChartName = keyof typeof CHART_PATHS;

/** ランキング RSS の URL。ジャンル指定は `limit=` の後ろに付ける。 */
export function chartUrl(
  baseUrl: string,
  options: { country: string; chart: ChartName; genre?: number; limit: number },
): URL {
  const segments = [
    options.country,
    "rss",
    CHART_PATHS[options.chart],
    `limit=${options.limit}`,
  ];
  if (options.genre !== undefined) segments.push(`genre=${options.genre}`);
  segments.push("json");
  return new URL(
    `/${segments.join("/")}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
}

/** ランキング RSS の JSON を正規化する（index 0 が 1 位）。 */
export function parseChart(body: unknown): ChartEntry[] {
  return asArray(at(at(body, "feed"), "entry")).map((entry, index) => {
    const attributes = at(at(entry, "id"), "attributes");
    const images = asArray(at(entry, "im:image"));
    const largest = images
      .map((image) => ({
        url: label(image) ?? "",
        height: Number(at(at(image, "attributes"), "height") ?? 0),
      }))
      .filter((image) => image.url.length > 0)
      .sort((a, b) => b.height - a.height)[0];
    const links = asArray(at(entry, "link"));
    const alternate = links.find((link) =>
      at(at(link, "attributes"), "rel") === "alternate"
    );
    const priceLabel = label(at(entry, "im:price"));
    return {
      rank: index + 1,
      id: asString(at(attributes, "im:id")) ?? "",
      bundleId: asString(at(attributes, "im:bundleId")) ?? "",
      name: label(at(entry, "im:name")) ?? "",
      developer: label(at(entry, "im:artist")) ?? "",
      icon: largest?.url ?? null,
      price: priceLabel === null ? null : {
        formatted: priceLabel,
        currency: asString(
          at(at(at(entry, "im:price"), "attributes"), "currency"),
        ),
      },
      category: asString(at(at(at(entry, "category"), "attributes"), "label")),
      url: asString(at(at(alternate, "attributes"), "href")) ?? "",
      raw: entry,
    } satisfies ChartEntry;
  });
}

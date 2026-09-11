import { asArray, asNumber, asString, at } from "./parse.ts";
import type { AppDetail, AppSummary, Price, RatingSummary } from "./types.ts";

/** iTunes Search API の URL を組み立てる。 */
export function searchUrl(
  baseUrl: string,
  term: string,
  options: { country: string; limit: number; lang?: string },
): URL {
  const url = new URL(
    "search",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  url.searchParams.set("term", term);
  url.searchParams.set("country", options.country);
  url.searchParams.set("entity", "software");
  url.searchParams.set("limit", String(options.limit));
  if (options.lang !== undefined) url.searchParams.set("lang", options.lang);
  return url;
}

/** iTunes Lookup API の URL を組み立てる（id か bundleId のどちらか）。 */
export function lookupUrl(
  baseUrl: string,
  query: { id?: string; bundleId?: string },
  options: { country: string; lang?: string },
): URL {
  const url = new URL(
    "lookup",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  if (query.id !== undefined) url.searchParams.set("id", query.id);
  if (query.bundleId !== undefined) {
    url.searchParams.set("bundleId", query.bundleId);
  }
  url.searchParams.set("country", options.country);
  if (options.lang !== undefined) url.searchParams.set("lang", options.lang);
  return url;
}

function toPrice(raw: unknown): Price | null {
  const value = asNumber(at(raw, "price"));
  const formatted = asString(at(raw, "formattedPrice"));
  const currency = asString(at(raw, "currency"));
  if (value === null || formatted === null || currency === null) return null;
  return { value, formatted, currency };
}

function toRating(raw: unknown): RatingSummary | null {
  const average = asNumber(at(raw, "averageUserRating"));
  const count = asNumber(at(raw, "userRatingCount"));
  if (average === null || count === null) return null;
  return { average, count };
}

/** Search / Lookup の 1 件を `AppSummary` に正規化する。 */
export function toAppSummary(raw: unknown): AppSummary {
  const id = asString(at(raw, "trackId")) ?? String(at(raw, "trackId") ?? "");
  return {
    id,
    bundleId: asString(at(raw, "bundleId")) ?? "",
    name: asString(at(raw, "trackName")) ?? "",
    developer: asString(at(raw, "artistName")) ?? "",
    icon: asString(at(raw, "artworkUrl512")) ??
      asString(at(raw, "artworkUrl100")),
    rating: toRating(raw),
    price: toPrice(raw),
    category: asString(at(raw, "primaryGenreName")),
    url: asString(at(raw, "trackViewUrl")) ?? "",
    raw,
  };
}

/** Lookup の 1 件を、ページ由来の項目を空にした `AppDetail` にする。 */
export function toAppDetailBase(raw: unknown): AppDetail {
  const summary = toAppSummary(raw);
  const screenshots = [
    ...asArray(at(raw, "screenshotUrls")).filter((url): url is string =>
      typeof url === "string"
    ),
    ...asArray(at(raw, "ipadScreenshotUrls")).filter((url): url is string =>
      typeof url === "string"
    ),
  ];
  const sizeText = asString(at(raw, "fileSizeBytes"));
  const sizeBytes = sizeText === null ? null : Number(sizeText);
  const releaseDate = asString(at(raw, "currentVersionReleaseDate"));
  return {
    ...summary,
    subtitle: null,
    description: asString(at(raw, "description")) ?? "",
    screenshots,
    ratingBreakdown: null,
    version: asString(at(raw, "version")),
    releaseNotes: asString(at(raw, "releaseNotes")),
    updatedAt: releaseDate === null || Number.isNaN(Date.parse(releaseDate))
      ? null
      : new Date(releaseDate),
    whatsNew: null,
    minimumOsVersion: asString(at(raw, "minimumOsVersion")),
    sizeBytes: sizeBytes !== null && Number.isFinite(sizeBytes)
      ? sizeBytes
      : null,
    languages: asArray(at(raw, "languageCodesISO2A")).filter((
      code,
    ): code is string => typeof code === "string"),
    contentRating: asString(at(raw, "contentAdvisoryRating")),
    genres: asArray(at(raw, "genres")).filter((genre): genre is string =>
      typeof genre === "string"
    ),
    privacy: [],
    inAppPurchases: [],
    relatedApps: [],
    developerApps: [],
    information: [],
    raw: { lookup: raw, page: null },
  };
}

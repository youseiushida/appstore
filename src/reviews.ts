import { asArray, at, label } from "./parse.ts";
import type { Review } from "./types.ts";

/** 公開レビュー RSS の URL。page は 1〜10（11 以上は Apple 側が 400 を返す）。 */
export function reviewsUrl(
  baseUrl: string,
  id: string,
  options: {
    country: string;
    page: number;
    sort: "mostRecent" | "mostHelpful";
  },
): URL {
  const path =
    `/${options.country}/rss/customerreviews/page=${options.page}/id=${id}/sortBy=${options.sort}/json`;
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

/**
 * レビュー RSS の JSON を正規化する。
 * RSS は件数が 1 件のとき `feed.entry` が配列ではなく単一オブジェクトになるため、
 * 必ず配列に揃えてから扱う。
 */
export function parseReviews(body: unknown): Review[] {
  const entries = asArray(at(at(body, "feed"), "entry"));
  return entries.map((entry) => {
    const updated = label(at(entry, "updated"));
    const author = label(at(at(entry, "author"), "name")) ??
      label(at(entry, "author")) ?? "";
    return {
      id: label(at(entry, "id")) ?? "",
      title: label(at(entry, "title")) ?? "",
      body: label(at(entry, "content")) ?? "",
      rating: Number(label(at(entry, "im:rating")) ?? 0),
      version: label(at(entry, "im:version")),
      author,
      updatedAt: updated !== null && !Number.isNaN(Date.parse(updated))
        ? new Date(updated)
        : new Date(0),
      voteSum: Number(label(at(entry, "im:voteSum")) ?? 0),
      voteCount: Number(label(at(entry, "im:voteCount")) ?? 0),
      raw: entry,
    };
  });
}

/** RSS の 1 ページは最大 50 件。 */
export const REVIEWS_PER_PAGE = 50;
/** 公開 RSS は 10 ページまでしか辿れない。 */
export const REVIEWS_MAX_PAGE = 10;

export function hasMoreReviews(page: number, itemCount: number): boolean {
  return page < REVIEWS_MAX_PAGE && itemCount === REVIEWS_PER_PAGE;
}

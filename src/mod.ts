/**
 * App Store の公開データ（iTunes API / 商品ページ / 公開 RSS）を 1 つの API にまとめる。
 *
 * 公開するのは 4 つの関数だけ。設定は毎回 options で渡すため、グローバル状態を持たず、
 * CLI からも並列に呼べる。実行時依存はゼロ（標準の fetch だけ）。
 */
import { type ChartName, chartUrl, parseChart } from "./charts.ts";
import { AppStoreError } from "./errors.ts";
import {
  lookupUrl,
  searchUrl,
  toAppDetailBase,
  toAppSummary,
} from "./itunes.ts";
import { type PageSnapshot, pageSnapshot } from "./page.ts";
import { asArray, at } from "./parse.ts";
import { hasMoreReviews, parseReviews, reviewsUrl } from "./reviews.ts";
import { ensureOk, parseJson, request } from "./transport.ts";
import type {
  AppDetail,
  AppOptions,
  AppSummary,
  ChartEntry,
  ChartsOptions,
  RequestOptions,
  ReviewPage,
  ReviewsOptions,
} from "./types.ts";

export const DEFAULT_COUNTRY = "us";
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_ITUNES_BASE_URL = "https://itunes.apple.com";
export const DEFAULT_APPS_BASE_URL = "https://apps.apple.com";
export const DEFAULT_SEARCH_LIMIT = 50;
export const DEFAULT_CHART_LIMIT = 50;
export const MAX_LIMIT = 200;
export const REVIEWS_MAX_PAGE = 10;

interface ResolvedOptions {
  country: string;
  lang: string | undefined;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  itunesBaseUrl: string;
  appsBaseUrl: string;
}

function resolve(options: RequestOptions | undefined): ResolvedOptions {
  const country = options?.country ?? DEFAULT_COUNTRY;
  if (!/^[a-z]{2}$/i.test(country)) {
    throw new AppStoreError(
      "invalidArgument",
      `country は 2 文字のストアフロントコードです: ${country}`,
    );
  }
  return {
    country: country.toLowerCase(),
    lang: options?.lang,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options?.signal,
    itunesBaseUrl: options?.itunesBaseUrl ?? DEFAULT_ITUNES_BASE_URL,
    appsBaseUrl: options?.appsBaseUrl ?? DEFAULT_APPS_BASE_URL,
  };
}

async function fetchJson(url: URL, options: ResolvedOptions): Promise<unknown> {
  const response = await request({
    url,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    accept: "application/json",
  });
  ensureOk(response);
  return parseJson(response);
}

/** キーワードでアプリを検索する（iTunes Search API）。 */
export async function searchApps(
  term: string,
  options?: RequestOptions & { limit?: number },
): Promise<AppSummary[]> {
  if (term.trim().length === 0) {
    throw new AppStoreError("invalidArgument", "検索語が空です");
  }
  const resolved = resolve(options);
  const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppStoreError(
      "invalidArgument",
      `limit は 1〜${MAX_LIMIT} です: ${limit}`,
    );
  }
  const body = await fetchJson(
    searchUrl(resolved.itunesBaseUrl, term, {
      country: resolved.country,
      limit,
      lang: resolved.lang,
    }),
    resolved,
  );
  return asArray(at(body, "results")).map(toAppSummary);
}

/**
 * アプリ 1 件の詳細を取得する。
 * 引数は「数字だけなら trackId」「ドットを含むなら bundleId」として扱う。
 * 既定では商品ページも取得し、サブタイトル・星別内訳・プライバシーなどを足す。
 */
export async function getApp(
  idOrBundleId: string,
  options?: AppOptions,
): Promise<AppDetail> {
  const identifier = idOrBundleId.trim();
  if (identifier.length === 0) {
    throw new AppStoreError("invalidArgument", "アプリ ID が空です");
  }
  const resolved = resolve(options);
  const query = /^\d+$/.test(identifier)
    ? { id: identifier }
    : identifier.includes(".")
    ? { bundleId: identifier }
    : { id: identifier };

  const lookupBody = await fetchJson(
    lookupUrl(resolved.itunesBaseUrl, query, {
      country: resolved.country,
      lang: resolved.lang,
    }),
    resolved,
  );
  const results = asArray(at(lookupBody, "results"));
  if (results.length === 0) {
    throw new AppStoreError(
      "notFound",
      `アプリが見つかりません（country=${resolved.country}）: ${identifier}`,
    );
  }
  const detail = toAppDetailBase(results[0]);

  if (options?.includePageData === false) return detail;

  const pageUrl = new URL(
    `/${resolved.country}/app/id${detail.id}`,
    resolved.appsBaseUrl.endsWith("/")
      ? resolved.appsBaseUrl
      : `${resolved.appsBaseUrl}/`,
  );
  if (resolved.lang !== undefined) pageUrl.searchParams.set("l", resolved.lang);
  const pageResponse = await request({
    url: pageUrl,
    timeoutMs: resolved.timeoutMs,
    signal: resolved.signal,
    accept: "text/html",
  });
  // アプリは存在するが商品ページが無い場合（Mac 専用など）は、Lookup の情報だけ返す
  if (pageResponse.status === 404) return detail;
  ensureOk(pageResponse);
  return mergePage(detail, pageSnapshot(pageResponse.text, resolved.country));
}

/** 商品ページの情報で詳細を補う。 */
function mergePage(detail: AppDetail, page: PageSnapshot): AppDetail {
  return {
    ...detail,
    subtitle: page.subtitle,
    description: detail.description.length > 0
      ? detail.description
      : page.description ?? "",
    screenshots: page.screenshots.length > 0
      ? page.screenshots
      : detail.screenshots,
    ratingBreakdown: page.ratingBreakdown,
    rating: page.ratingAverage !== null && page.ratingCount !== null
      ? { average: page.ratingAverage, count: page.ratingCount }
      : detail.rating,
    releaseNotes: detail.releaseNotes ?? page.whatsNew?.text ?? null,
    whatsNew: page.whatsNew,
    privacy: page.privacy,
    inAppPurchases: page.inAppPurchases,
    relatedApps: page.relatedApps,
    developerApps: page.developerApps,
    information: page.information,
    raw: { lookup: detail.raw.lookup, page: page.raw },
  };
}

/** 公開レビュー RSS からレビューを取得する（最大 10 ページ = 500 件）。 */
export async function getReviews(
  id: string,
  options?: ReviewsOptions,
): Promise<ReviewPage> {
  if (String(id).trim().length === 0) {
    throw new AppStoreError("invalidArgument", "アプリ ID が空です");
  }
  const page = options?.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > REVIEWS_MAX_PAGE) {
    throw new AppStoreError(
      "invalidArgument",
      `page は 1〜${REVIEWS_MAX_PAGE} です（公開 RSS は 10 ページまで）: ${page}`,
    );
  }
  const resolved = resolve(options);
  const sort = options?.sort ?? "mostRecent";
  const body = await fetchJson(
    reviewsUrl(resolved.itunesBaseUrl, String(id), {
      country: resolved.country,
      page,
      sort,
    }),
    resolved,
  );
  const items = parseReviews(body);
  return {
    items,
    page,
    hasMore: hasMoreReviews(page, items.length),
    raw: body,
  };
}

/** ランキング（無料 / 有料 / 売上 / 新着）を取得する。 */
export async function getTopCharts(
  options?: ChartsOptions,
): Promise<ChartEntry[]> {
  const resolved = resolve(options);
  const chart: ChartName = options?.chart ?? "topFree";
  const limit = options?.limit ?? DEFAULT_CHART_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppStoreError(
      "invalidArgument",
      `limit は 1〜${MAX_LIMIT} です: ${limit}`,
    );
  }
  if (
    options?.genre !== undefined &&
    (!Number.isInteger(options.genre) || options.genre <= 0)
  ) {
    throw new AppStoreError(
      "invalidArgument",
      `genre は正の整数です: ${options.genre}`,
    );
  }
  const body = await fetchJson(
    chartUrl(resolved.itunesBaseUrl, {
      country: resolved.country,
      chart,
      genre: options?.genre,
      limit,
    }),
    resolved,
  );
  return parseChart(body);
}

export { AppStoreError };
export type { AppStoreErrorDetails, AppStoreErrorKind } from "./errors.ts";
export type {
  AppDetail,
  AppOptions,
  AppSummary,
  ChartEntry,
  ChartPrice,
  ChartsOptions,
  InAppPurchase,
  InformationItem,
  Price,
  PrivacyLabel,
  RatingSummary,
  RelatedApp,
  RequestOptions,
  Review,
  ReviewPage,
  ReviewsOptions,
  WhatsNew,
} from "./types.ts";

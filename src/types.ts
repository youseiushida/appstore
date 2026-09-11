/** 価格（iTunes API の price / formattedPrice / currency）。 */
export interface Price {
  value: number;
  formatted: string;
  currency: string;
}

/** ランキング RSS の価格（表示文字列と通貨コードのみ）。 */
export interface ChartPrice {
  formatted: string;
  currency: string | null;
}

/** 平均評価と件数。 */
export interface RatingSummary {
  average: number;
  count: number;
}

/** 検索結果・チャートの 1 件。 */
export interface AppSummary {
  /** trackId（数字文字列） */
  id: string;
  bundleId: string;
  name: string;
  developer: string;
  icon: string | null;
  rating: RatingSummary | null;
  price: Price | null;
  category: string | null;
  /** 商品ページ URL */
  url: string;
  raw: unknown;
}

/** プライバシー表示の 1 項目（商品ページ由来）。 */
export interface PrivacyLabel {
  /** DATA_USED_TO_TRACK_YOU / DATA_LINKED_TO_YOU / DATA_NOT_LINKED_TO_YOU */
  identifier: string;
  title: string;
  detail: string | null;
  /** 対象データのカテゴリ名（例 "購入", "ID"） */
  categories: string[];
}

/** アプリ内購入の 1 項目（商品ページ由来）。 */
export interface InAppPurchase {
  name: string;
  price: string;
}

/** 関連アプリ・同開発者の他アプリ（商品ページ由来）。 */
export interface RelatedApp {
  id: string;
  bundleId: string;
  name: string;
  icon: string | null;
  rating: number | null;
  ratingCount: number | null;
  price: ChartPrice | null;
  url: string;
}

/** 情報欄（販売元・サイズ・カテゴリ・互換性・言語・著作権など）。 */
export interface InformationItem {
  title: string;
  value: string;
}

/** 最新バージョンの情報（商品ページ由来）。 */
export interface WhatsNew {
  text: string;
  /** 例 "バージョン10.6"（言語により "Version 10.6"） */
  versionLabel: string | null;
  date: Date | null;
}

/** アプリ詳細。iTunes Lookup を基準に、商品ページの情報を足したもの。 */
export interface AppDetail extends Omit<AppSummary, "raw"> {
  /** サブタイトル（iTunes API には無く、商品ページにのみ存在する） */
  subtitle: string | null;
  description: string;
  screenshots: string[];
  /** [5★, 4★, 3★, 2★, 1★] の件数（商品ページ由来） */
  ratingBreakdown: [number, number, number, number, number] | null;
  version: string | null;
  releaseNotes: string | null;
  updatedAt: Date | null;
  whatsNew: WhatsNew | null;
  minimumOsVersion: string | null;
  sizeBytes: number | null;
  languages: string[];
  contentRating: string | null;
  genres: string[];
  privacy: PrivacyLabel[];
  inAppPurchases: InAppPurchase[];
  relatedApps: RelatedApp[];
  developerApps: RelatedApp[];
  information: InformationItem[];
  raw: { lookup: unknown; page: unknown | null };
}

/** レビュー 1 件（公開 RSS 由来）。 */
export interface Review {
  id: string;
  title: string;
  body: string;
  /** 星 1〜5 */
  rating: number;
  /** レビュー時のアプリのバージョン */
  version: string | null;
  author: string;
  updatedAt: Date;
  voteSum: number;
  voteCount: number;
  raw: unknown;
}

/** レビュー 1 ページ分。RSS は最大 10 ページ（= 500 件）まで。 */
export interface ReviewPage {
  items: Review[];
  page: number;
  hasMore: boolean;
  raw: unknown;
}

/** ランキングの 1 件。 */
export interface ChartEntry {
  /** 1 位から始まる順位 */
  rank: number;
  id: string;
  bundleId: string;
  name: string;
  developer: string;
  icon: string | null;
  price: ChartPrice | null;
  category: string | null;
  url: string;
  raw: unknown;
}

/** すべての関数が受け取る共通オプション。 */
export interface RequestOptions {
  /** ストアフロント（例 "us", "jp"）。既定 "us" */
  country?: string;
  /** 言語（例 "ja_jp", "en_us"）。未指定ならストアフロントの既定 */
  lang?: string;
  /** 1 リクエストのタイムアウト（ミリ秒）。既定 15000 */
  timeoutMs?: number;
  /** 利用者側のキャンセル用シグナル */
  signal?: AbortSignal;
  /** iTunes API の接続先。既定 "https://itunes.apple.com" */
  itunesBaseUrl?: string;
  /** 商品ページの接続先。既定 "https://apps.apple.com" */
  appsBaseUrl?: string;
}

/** `getApp` だけが追加で受け取るオプション。 */
export interface AppOptions extends RequestOptions {
  /** 商品ページまで取得するか。既定 true（false にすると Lookup のみで軽い） */
  includePageData?: boolean;
}

/** `getReviews` だけが追加で受け取るオプション。 */
export interface ReviewsOptions extends RequestOptions {
  /** 1〜10。既定 1 */
  page?: number;
  /** 並び順。既定 "mostRecent" */
  sort?: "mostRecent" | "mostHelpful";
}

/** `getTopCharts` だけが追加で受け取るオプション。 */
export interface ChartsOptions extends RequestOptions {
  /** 既定 "topFree" */
  chart?: "topFree" | "topPaid" | "topGrossing" | "new";
  /** ジャンル ID（例 6017 = Education）。未知の ID は Apple 側で無視される */
  genre?: number;
  /** 取得件数。既定 50（上限 200） */
  limit?: number;
}

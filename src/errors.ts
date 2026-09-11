/**
 * 失敗の種類。呼び出し側が「リトライすべきか」「設定ミスか」を判断できるようにする。
 *
 * - `network`          fetch 自体が失敗した
 * - `timeout`          `timeoutMs` を超えた
 * - `aborted`          利用者の `AbortSignal` でキャンセルされた
 * - `http`             HTTP 400 以上（RSS の 400/500 など）
 * - `notFound`         lookup が 0 件（存在しない・未配信のストアフロント）
 * - `invalidArgument`  ID が空、`page` が 1〜10 外、`limit` が範囲外など
 * - `parse`            応答の形式が想定外（JSON でない・必要な要素が無い）
 */
export type AppStoreErrorKind =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "notFound"
  | "invalidArgument"
  | "parse";

/** `AppStoreError` に付く文脈情報。 */
export interface AppStoreErrorDetails {
  status?: number;
  url?: string;
  cause?: unknown;
}

/** このライブラリが投げる唯一のエラー型。 */
export class AppStoreError extends Error {
  readonly kind: AppStoreErrorKind;
  readonly status: number | undefined;
  readonly url: string | undefined;

  constructor(
    kind: AppStoreErrorKind,
    message: string,
    details: AppStoreErrorDetails = {},
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "AppStoreError";
    this.kind = kind;
    this.status = details.status;
    this.url = details.url;
  }
}

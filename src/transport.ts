import { AppStoreError } from "./errors.ts";

/** 送信時に名乗る UA。ブラウザを装わず、素の fetch で動くことを示す。 */
export const USER_AGENT =
  "appstore-js/0.1.0 (+https://github.com/youseiushida/appstore)";

export interface RawResponse {
  status: number;
  contentType: string | null;
  text: string;
  url: string;
}

export interface RequestOptions {
  url: URL;
  timeoutMs: number;
  signal?: AbortSignal;
  accept?: string;
}

/**
 * 1 回だけ GET する。失敗は `AppStoreError` に正規化する（自動リトライはしない）。
 * HTTP ステータスの扱いは呼び出し側に任せる（404 は notFound、400 は http など）。
 */
export async function request(options: RequestOptions): Promise<RawResponse> {
  const url = options.url.toString();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const userSignal = options.signal;
  const onUserAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) onUserAbort();
    else userSignal.addEventListener("abort", onUserAbort, { once: true });
  }

  try {
    const response = await fetch(options.url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": "ja,en;q=0.9",
        ...(options.accept === undefined ? {} : { accept: options.accept }),
      },
      signal: controller.signal,
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
      url,
    };
  } catch (cause) {
    if (timedOut) {
      throw new AppStoreError(
        "timeout",
        `${options.timeoutMs}ms 以内に応答がありませんでした`,
        {
          url,
          cause,
        },
      );
    }
    if (userSignal?.aborted) {
      throw new AppStoreError("aborted", "呼び出しがキャンセルされました", {
        url,
        cause,
      });
    }
    throw new AppStoreError(
      "network",
      `ネットワークエラー: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { url, cause },
    );
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", onUserAbort);
  }
}

/** 200 以外は http エラーにする。 */
export function ensureOk(response: RawResponse): void {
  if (response.status >= 400) {
    throw new AppStoreError("http", `HTTP ${response.status} が返りました`, {
      status: response.status,
      url: response.url,
    });
  }
}

/** JSON として読む。読めなければ parse エラー。 */
export function parseJson(response: RawResponse): unknown {
  try {
    return JSON.parse(response.text);
  } catch (cause) {
    throw new AppStoreError(
      "parse",
      `応答を JSON として解析できません: ${response.url}`,
      {
        url: response.url,
        cause,
      },
    );
  }
}

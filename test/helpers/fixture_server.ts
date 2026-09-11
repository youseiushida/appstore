// deno-coverage-ignore-file
// テスト基盤（記録済み応答を返す HTTP サーバ）なのでカバレッジ対象から外す
/**
 * 記録済みの応答を返すローカル HTTP サーバ（2 面構成）。
 *
 *   itunes 面 … /search /lookup /{country}/rss/... を返す
 *   apps 面   … /{country}/app/id{id} を返す
 *
 * デトロイト学派の方針で HTTP 層は差し替えず、本物の fetch / Deno.serve を通す。
 * 差し替えるのは接続先（itunesBaseUrl / appsBaseUrl）だけ。
 */

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);

export interface Fixture {
  name: string;
  face: "itunes" | "apps";
  pathPattern: string;
  params: Record<string, string>;
  status: number;
  contentType: string | null;
  body: string;
}

export async function loadFixture(name: string): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`${name}.json`, FIXTURE_DIR)),
  ) as Fixture;
}

export function loadFixtures(names: string[]): Promise<Fixture[]> {
  return Promise.all(names.map(loadFixture));
}

export interface RecordedRequest {
  face: "itunes" | "apps";
  url: URL;
  pathname: string;
  params: Record<string, string>;
}

export interface ResponseOverride {
  status?: number;
  body?: string;
  contentType?: string;
  delayMs?: number;
}

export interface FixtureServers {
  itunesUrl: string;
  appsUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFixtureServers(
  fixtures: Fixture[],
  override?: (request: RecordedRequest) => ResponseOverride | undefined,
): Promise<FixtureServers> {
  const requests: RecordedRequest[] = [];

  const handle = (face: "itunes" | "apps") =>
  async (
    request: Request,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams) params[key] = value;
    const recorded: RecordedRequest = {
      face,
      url,
      pathname: url.pathname,
      params,
    };
    requests.push(recorded);

    const fixture = fixtures.find((item) =>
      item.face === face &&
      new RegExp(item.pathPattern).test(url.pathname) &&
      Object.entries(item.params).every(([key, value]) => params[key] === value)
    );
    if (!fixture) return new Response("", { status: 404 });

    const patch = override?.(recorded) ?? {};
    if (patch.delayMs !== undefined) {
      await new Promise((done) => setTimeout(done, patch.delayMs));
    }
    return new Response(patch.body ?? fixture.body, {
      status: patch.status ?? fixture.status,
      headers: {
        "content-type": patch.contentType ?? fixture.contentType ??
          "text/plain",
      },
    });
  };

  const itunesPort = Promise.withResolvers<number>();
  const appsPort = Promise.withResolvers<number>();
  const itunes = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      onListen: (address) => itunesPort.resolve(address.port),
    },
    handle("itunes"),
  );
  const apps = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      onListen: (address) => appsPort.resolve(address.port),
    },
    handle("apps"),
  );

  return {
    itunesUrl: `http://127.0.0.1:${await itunesPort.promise}`,
    appsUrl: `http://127.0.0.1:${await appsPort.promise}`,
    requests,
    close: async () => {
      await itunes.shutdown();
      await apps.shutdown();
    },
  };
}

/** サーバを立ててテスト本体を実行し、必ず閉じる。 */
export async function withFixtureServers(
  fixtures: Fixture[],
  body: (servers: FixtureServers) => Promise<void>,
  override?: (request: RecordedRequest) => ResponseOverride | undefined,
): Promise<void> {
  const servers = await startFixtureServers(fixtures, override);
  try {
    await body(servers);
  } finally {
    await servers.close();
  }
}

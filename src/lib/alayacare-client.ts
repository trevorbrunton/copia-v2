/**
 * Server-side AlayaCare API client.
 * Proxies requests from our API routes to the mock-alaya backend.
 */

const ALAYACARE_API_URL =
  process.env.ALAYACARE_API_URL || "https://mock-alaya.vercel.app";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getAuthHeader(): string {
  const pub = getRequiredEnv("ALAYACARE_PUBLIC_KEY");
  const priv = getRequiredEnv("ALAYACARE_PRIVATE_KEY");
  return `Basic ${Buffer.from(`${pub}:${priv}`).toString("base64")}`;
}

export interface AlayaPaginatedResponse<T = Record<string, unknown>> {
  count: number;
  page: number;
  total_pages: number;
  items: T[];
}

export interface AlayaRequestOptions {
  method?: string;
  body?: unknown;
  searchParams?: URLSearchParams | Record<string, string>;
}

/**
 * Make a request to the AlayaCare API.
 * @param path - API path relative to /ext/api/v2 (e.g. "/scheduler/visits")
 */
export async function alayaFetch<T = unknown>(
  path: string,
  options: AlayaRequestOptions = {}
): Promise<T> {
  const { method = "GET", body, searchParams } = options;

  let url = `${ALAYACARE_API_URL}/ext/api/v2${path}`;

  if (searchParams) {
    const params =
      searchParams instanceof URLSearchParams
        ? searchParams
        : new URLSearchParams(searchParams);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      detail = body.slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      `AlayaCare API error: ${res.status} ${res.statusText} — ${method} ${url}${detail ? ` — ${detail}` : ""}`
    );
  }

  return res.json() as Promise<T>;
}

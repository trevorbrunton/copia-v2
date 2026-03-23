type HeadersFn = () => Promise<Record<string, string>> | Record<string, string>;

interface ApiClientConfig {
  baseUrl: string;
  getHeaders?: HeadersFn;
}

let config: ApiClientConfig = {
  baseUrl: "",
};

export function configureApiClient(newConfig: Partial<ApiClientConfig>) {
  config = { ...config, ...newConfig };
}

export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${config.baseUrl}${input}`;
  }

  if (config.getHeaders) {
    const extraHeaders = await config.getHeaders();
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
    init = { ...init, headers };
  }

  const response = await fetch(input, init);

  if (
    typeof window !== "undefined" &&
    response.status === 403
  ) {
    const cloned = response.clone();
    const body = await cloned.json().catch(() => null);
    if (
      body?.code === "ACCOUNT_SUSPENDED" ||
      body?.code === "ACCOUNT_DELETED"
    ) {
      window.dispatchEvent(
        new CustomEvent("account-status-error", {
          detail: { code: body.code, reason: body.reason },
        })
      );
    }
  }

  return response;
}

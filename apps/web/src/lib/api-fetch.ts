/**
 * Fetch mutator used by the orval-generated API client (axios-style config in,
 * `Promise<T>` out). Sends the session cookie (same-origin), serialises JSON,
 * and turns the API's error envelope into a typed {@link ApiError} that TanStack
 * Query surfaces as a query/mutation error.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  /** Envelope form, so the thrown value also matches the generated `ErrorResponse` type. */
  readonly error: { code: string; message: string; details?: unknown };

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.error = { code, message, ...(details !== undefined ? { details } : {}) };
  }
}

export interface RequestConfig {
  url: string;
  method: string;
  params?: Record<string, string | number | boolean | undefined | null> | undefined;
  data?: unknown;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  responseType?: string | undefined;
}

export async function apiFetch<T>(config: RequestConfig): Promise<T> {
  const url = new URL(config.url, window.location.origin);
  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const hasBody = config.data !== undefined && config.data !== null;
  const init: RequestInit = {
    method: config.method.toUpperCase(),
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...config.headers,
    },
  };
  if (config.signal) init.signal = config.signal;
  if (hasBody) init.body = JSON.stringify(config.data);

  const res = await fetch(url.toString(), init);
  const contentType = res.headers.get("content-type") ?? "";

  async function parseBody(): Promise<unknown> {
    if (res.status === 204) return undefined;
    if (contentType.includes("application/json")) {
      const text = await res.text();
      return text ? (JSON.parse(text) as unknown) : undefined;
    }
    return res.text();
  }

  if (!res.ok) {
    const body = (await parseBody()) as ApiErrorBody | undefined;
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "error",
      err?.message ?? res.statusText,
      err?.details,
    );
  }

  return (await parseBody()) as T;
}

import { requireProductionMode } from "./config.js";

export type GraphMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface GraphClient {
  request<T>(method: GraphMethod, path: string, body?: unknown): Promise<T>;
}

export type GraphThrottleInfo = {
  path: string;
  attempt: number;
  retryAfterMs: number;
};

export type HttpGraphClientOptions = {
  maxThrottleRetries?: number;
  onThrottle?: (info: GraphThrottleInfo) => void;
  onThrottleRecovered?: () => void;
};

export function graphErrorDetail(responseBody: string) {
  try {
    const parsed = JSON.parse(responseBody) as { error?: { code?: string; message?: string } };
    const code = parsed.error?.code?.trim();
    const message = parsed.error?.message?.trim();
    return [code, message].filter(Boolean).join(": ");
  } catch {
    return "";
  }
}

export class MicrosoftGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
  }
}

export class HttpGraphClient implements GraphClient {
  constructor(private readonly accessToken: string, private readonly options: HttpGraphClientOptions = {}) {}

  async request<T>(method: GraphMethod, path: string, body?: unknown): Promise<T> {
    requireProductionMode("Microsoft Graph HTTP client");
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
    const maxThrottleRetries = this.options.maxThrottleRetries ?? 8;
    let throttled = false;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) {
        if (throttled) this.options.onThrottleRecovered?.();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      if ([429, 503, 504].includes(response.status) && attempt < maxThrottleRetries) {
        throttled = true;
        const retryAfterMs = graphRetryDelayMs(response.headers.get("retry-after"), attempt);
        this.options.onThrottle?.({ path, attempt: attempt + 1, retryAfterMs });
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        continue;
      }
      const detail = graphErrorDetail(text);
      throw new MicrosoftGraphError(
        `Microsoft Graph ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : "."}`,
        response.status,
        text,
      );
    }
  }
}

export function graphRetryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(250, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(250, date - now);
  }
  const exponential = Math.min(60_000, 1_000 * 2 ** attempt);
  return exponential + Math.floor(Math.random() * Math.min(2_000, exponential * 0.25));
}

export type MockGraphRequest = { method: GraphMethod; path: string; body?: unknown };

export class MockGraphClient implements GraphClient {
  readonly requests: MockGraphRequest[] = [];

  constructor(private readonly handler: (request: MockGraphRequest) => unknown | Promise<unknown>) {}

  async request<T>(method: GraphMethod, path: string, body?: unknown): Promise<T> {
    const request = { method, path, body };
    this.requests.push(request);
    return await this.handler(request) as T;
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; initialDelayMs?: number; shouldRetry?: (error: unknown) => boolean } = {},
) {
  const attempts = options.attempts ?? 5;
  const initialDelayMs = options.initialDelayMs ?? 300;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || options.shouldRetry?.(error) === false) throw error;
      await new Promise((resolve) => setTimeout(resolve, initialDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

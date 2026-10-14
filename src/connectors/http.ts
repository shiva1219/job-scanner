// Shared polite HTTP client for every connector. Shared contract: do not change without asking.

export const USER_AGENT = 'JobScanner/0.1 (personal job search; contact: shiva1219@gmail.com)';
const MIN_GAP_MS = 1000;      // at most 1 request per second per host
const TIMEOUT_MS = 15_000;

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
  /** 403 or 429: the site doesn't want us. Stop calling it and log it. */
  get blocked(): boolean { return this.status === 403 || this.status === 429; }
}

const nextSlot = new Map<string, number>();

/** Waits until this host's next free slot, so calls to one host are spaced 1s apart. */
async function waitForHost(host: string, gapMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + gapMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export interface PoliteOptions {
  method?: 'GET' | 'POST';
  body?: unknown;              // sent as JSON when present
  headers?: Record<string, string>;
  gapMs?: number;              // tests only; production uses the 1s default
  timeoutMs?: number;
}

/** Fetches JSON politely: rate-limited per host, timeout, user-agent, one retry on 5xx or network error. */
export async function politeJson<T = unknown>(url: string, opts: PoliteOptions = {}): Promise<T> {
  return (await politeRequest(url, 'application/json', opts)).json() as Promise<T>;
}

/** Same rules as politeJson, but returns text (for HTML careers pages) plus the final URL after redirects. */
export async function politeText(url: string, opts: PoliteOptions = {}): Promise<{ text: string; finalUrl: string }> {
  const res = await politeRequest(url, 'text/html,application/xhtml+xml', opts);
  return { text: await res.text(), finalUrl: res.url || url };
}

async function politeRequest(url: string, accept: string, opts: PoliteOptions): Promise<Response> {
  const host = new URL(url).host;
  const gap = opts.gapMs ?? MIN_GAP_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForHost(host, gap);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
      if (res.ok) return res;
      const err = new HttpError(res.status, url);
      if (res.status < 500) throw err;   // 4xx: don't retry
      lastError = err;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

/** Test helper: forget host timing between tests. */
export function resetRateLimits(): void { nextSlot.clear(); }

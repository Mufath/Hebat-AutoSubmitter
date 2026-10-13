/**
 * src/moodle/http.ts
 * HTTP utilities for Cloudflare Workers & Node.js fetch:
 * - CookieJar for cookie persistence
 * - Budget for subrequest quota tracking (Cloudflare 50 subrequests limit)
 * - mfetch for manual multi-hop redirect handling
 */

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

interface HeadersWithSetCookie {
  getSetCookie?: () => string[];
}

export class CookieJar {
  private cookies = new Map<string, string>();

  ingest(res: Response): void {
    const headers = res.headers as unknown as HeadersWithSetCookie;
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const sc of raw) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (i > 0) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (/max-age=0|expires=[^;]*1970/i.test(sc) || v === '') {
          this.cookies.delete(k);
        } else {
          this.cookies.set(k, v);
        }
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  dump(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  static load(obj: Record<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [k, v] of Object.entries(obj)) {
      jar.cookies.set(k, v);
    }
    return jar;
  }
}

export class Budget {
  constructor(private left = 48) {}

  take(n = 1): void {
    if (this.left < n) {
      throw new Error('SUBREQUEST_BUDGET_EXCEEDED');
    }
    this.left -= n;
  }

  get remaining(): number {
    return this.left;
  }
}

export interface MFetchResult {
  res: Response;
  url: string;
  hops: number;
  elapsedMs: number;
}

export async function mfetch(
  jar: CookieJar,
  bud: Budget,
  url: string,
  init: RequestInit = {},
  maxHops = 6
): Promise<MFetchResult> {
  let targetUrl = url;
  let method = init.method ?? 'GET';
  let body = init.body;
  const headers: Record<string, string> = {
    'user-agent': DEFAULT_USER_AGENT,
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    ...((init.headers as Record<string, string>) || {}),
  };

  const t0 = performance.now();
  for (let hop = 0; hop <= maxHops; hop++) {
    bud.take(1);

    const reqHeaders: Record<string, string> = { ...headers };
    const cookieHeader = jar.header();
    if (cookieHeader) {
      reqHeaders['cookie'] = cookieHeader;
    }

    const fetchInit: RequestInit = {
      ...init,
      method,
      body,
      redirect: 'manual',
      headers: reqHeaders,
    };

    const res = await fetch(targetUrl, fetchInit);
    jar.ingest(res);

    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      targetUrl = new URL(loc, targetUrl).toString();
      method = 'GET';
      body = undefined;
      delete headers['content-type'];
      delete headers['Content-Type'];
      continue;
    }

    const elapsedMs = Math.round(performance.now() - t0);
    return { res, url: targetUrl, hops: hop, elapsedMs };
  }

  throw new Error(`TOO_MANY_REDIRECTS: exceeded ${maxHops} hops`);
}

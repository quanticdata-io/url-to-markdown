import { UrlToMarkdownError } from './errors';
import type { FetchOptions } from './types';
import { VERSION } from './version';

export const DEFAULT_USER_AGENT = `Mozilla/5.0 (compatible; url-to-markdown/${VERSION}; +https://github.com/quanticdata-io/url-to-markdown)`;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  headers: Headers;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Retries a request that failed before any response arrived (connection
 * refused or reset, DNS hiccup). GET is idempotent, so this is safe; timeouts
 * and caller aborts are not retried.
 */
async function withRetries(send: () => Promise<Response>, retries: number, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (signal.aborted || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
    }
  }
}

export function assertHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UrlToMarkdownError(`Invalid URL: ${raw}`, 'invalid_url', { url: raw });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UrlToMarkdownError(`Only http and https URLs are supported: ${raw}`, 'invalid_url', { url: raw });
  }
  return u;
}

function charsetOf(contentType: string): string {
  const m = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType);
  return m?.[1]?.toLowerCase() ?? 'utf-8';
}

function decode(bytes: Uint8Array, contentType: string): string {
  let charset = charsetOf(contentType);
  if (!/charset/i.test(contentType) && /html/i.test(contentType)) {
    // Look for <meta charset> in the first bytes when the header does not say.
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
    if (meta?.[1]) charset = meta[1].toLowerCase();
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function readLimited(res: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UrlToMarkdownError(`Response is larger than ${maxBytes} bytes: ${url}`, 'too_large', { url, status: res.status });
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UrlToMarkdownError(`Response is larger than ${maxBytes} bytes: ${url}`, 'too_large', { url, status: res.status });
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/**
 * Fetches a URL with browser-like headers, a timeout, a size limit and manual
 * redirect handling (so redirects to non-http schemes are refused).
 * Non-2xx answers are returned, not thrown: callers decide what a block is.
 */
export async function fetchPage(rawUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRedirects = opts.maxRedirects ?? 10;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const headers: Record<string, string> = {
    'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    ...opts.headers,
  };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let current = assertHttpUrl(rawUrl);
  try {
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await withRetries(() => fetchImpl(current.href, { headers, redirect: 'manual', signal: controller.signal }), opts.retries ?? 2, controller.signal);
      } catch (err) {
        if (timedOut) throw new UrlToMarkdownError(`Timed out after ${timeoutMs} ms: ${rawUrl}`, 'timeout', { url: rawUrl, cause: err });
        throw new UrlToMarkdownError(`Cannot fetch ${current.href}: ${(err as Error).message}`, 'network', { url: rawUrl, cause: err });
      }
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new UrlToMarkdownError(`Redirect without Location from ${current.href}`, 'redirects', { url: rawUrl, status: res.status });
        if (hop >= maxRedirects) throw new UrlToMarkdownError(`More than ${maxRedirects} redirects: ${rawUrl}`, 'redirects', { url: rawUrl });
        current = assertHttpUrl(new URL(location, current).href);
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      let bytes: Uint8Array;
      try {
        bytes = await readLimited(res, maxBytes, rawUrl);
      } catch (err) {
        if (err instanceof UrlToMarkdownError) throw err;
        if (timedOut) throw new UrlToMarkdownError(`Timed out after ${timeoutMs} ms: ${rawUrl}`, 'timeout', { url: rawUrl, cause: err });
        throw new UrlToMarkdownError(`Connection lost while reading ${current.href}`, 'network', { url: rawUrl, cause: err });
      }
      return { url: rawUrl, finalUrl: current.href, status: res.status, contentType, body: decode(bytes, contentType), headers: res.headers };
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Raw bytes variant (used for gzipped sitemaps). */
export async function fetchBytes(rawUrl: string, opts: FetchOptions = {}): Promise<{ status: number; contentType: string; bytes: Uint8Array; finalUrl: string }> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const href = assertHttpUrl(rawUrl).href;
    const res = await withRetries(
      () => fetchImpl(href, { headers: { 'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT, ...opts.headers }, signal: controller.signal }),
      opts.retries ?? 2,
      controller.signal,
    );
    const bytes = await readLimited(res, opts.maxBytes ?? 50 * 1024 * 1024, rawUrl);
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', bytes, finalUrl: res.url || rawUrl };
  } catch (err) {
    if (err instanceof UrlToMarkdownError) throw err;
    throw new UrlToMarkdownError(`Cannot fetch ${rawUrl}: ${(err as Error).message}`, controller.signal.aborted ? 'timeout' : 'network', { url: rawUrl, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

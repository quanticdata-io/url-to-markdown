import { gunzipSync } from 'node:zlib';
import { UrlToMarkdownError } from './errors';
import { assertHttpUrl, fetchBytes } from './fetch';
import type { FetchOptions } from './types';

export interface SitemapOptions extends FetchOptions {
  /** Stop after this many page URLs. Default 1000. */
  limit?: number;
  /** Keep only URLs matching this pattern. */
  include?: RegExp;
  /** Drop URLs matching this pattern. */
  exclude?: RegExp;
  /** Maximum nested sitemap index depth. Default 3. */
  maxDepth?: number;
  /** Keep only URLs on the same host as the start URL. Default true. */
  sameHost?: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Reads `<loc>` entries from a sitemap or sitemap index document. */
export function parseSitemap(xml: string): { kind: 'index' | 'urlset' | 'unknown'; locs: string[] } {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index' : /<urlset[\s>]/i.test(xml) ? 'urlset' : 'unknown';
  const locs: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) locs.push(decodeEntities(m[1]!));
  return { kind, locs };
}

async function readText(url: string, opts: FetchOptions): Promise<string | undefined> {
  const r = await fetchBytes(url, opts);
  if (r.status >= 400) return undefined;
  let bytes = r.bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Lists the page URLs of a site from its sitemaps.
 *
 * `start` can be a sitemap (`.../sitemap.xml`, `.xml.gz`, or a sitemap index)
 * or any page of the site: then `robots.txt` `Sitemap:` lines are read, with
 * `/sitemap.xml` as the fallback.
 */
export async function discoverSitemapUrls(start: string, opts: SitemapOptions = {}): Promise<string[]> {
  const startUrl = assertHttpUrl(start);
  const limit = opts.limit ?? 1000;
  const maxDepth = opts.maxDepth ?? 3;
  const sameHost = opts.sameHost ?? true;

  let roots: string[];
  if (/\.xml(\.gz)?$/i.test(startUrl.pathname) || /sitemap/i.test(startUrl.pathname)) {
    roots = [startUrl.href];
  } else {
    const robots = await readText(new URL('/robots.txt', startUrl).href, opts).catch(() => undefined);
    const fromRobots = (robots ?? '')
      .split(/\r?\n/)
      .map((l) => /^\s*sitemap:\s*(\S+)/i.exec(l)?.[1])
      .filter((v): v is string => Boolean(v));
    roots = fromRobots.length ? fromRobots : [new URL('/sitemap.xml', startUrl).href];
  }

  const seenSitemaps = new Set<string>();
  const out = new Set<string>();
  const queue: { url: string; depth: number }[] = roots.map((url) => ({ url, depth: 0 }));
  while (queue.length && out.size < limit) {
    const { url, depth } = queue.shift()!;
    if (seenSitemaps.has(url)) continue;
    seenSitemaps.add(url);
    const xml = await readText(url, opts);
    if (xml === undefined) continue;
    const { kind, locs } = parseSitemap(xml);
    if (kind === 'index') {
      if (depth < maxDepth) for (const loc of locs) queue.push({ url: loc, depth: depth + 1 });
      continue;
    }
    for (const loc of locs) {
      let u: URL;
      try {
        u = assertHttpUrl(loc);
      } catch {
        continue;
      }
      if (sameHost && u.hostname.replace(/^www\./, '') !== startUrl.hostname.replace(/^www\./, '')) continue;
      if (opts.include && !opts.include.test(u.href)) continue;
      if (opts.exclude && opts.exclude.test(u.href)) continue;
      out.add(u.href);
      if (out.size >= limit) break;
    }
  }
  if (seenSitemaps.size > 0 && out.size === 0 && queue.length === 0) {
    // Nothing usable: say so instead of silently returning an empty crawl.
    const tried = [...seenSitemaps].join(', ');
    throw new UrlToMarkdownError(`No page URLs found in the sitemap(s): ${tried}`, 'http', { url: start });
  }
  return [...out];
}

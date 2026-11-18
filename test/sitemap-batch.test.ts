import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverSitemapUrls, fetchMarkdownBatch, parseSitemap, type BatchItem } from '../src';
import { readFixture } from './helpers';
import { startTestServer, type TestServer } from './server';

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

describe('parseSitemap', () => {
  it('reads urlset and index documents, entities and CDATA', () => {
    const urlset = parseSitemap(readFixture('sitemap-pages.xml').replaceAll('{{BASE}}', 'https://s.example'));
    expect(urlset.kind).toBe('urlset');
    expect(urlset.locs).toContain('https://s.example/docs?lang=en&v=2');
    expect(urlset.locs).toContain('https://s.example/blog/three');
    expect(parseSitemap(readFixture('sitemap-index.xml')).kind).toBe('index');
  });
});

describe('discoverSitemapUrls', () => {
  it('follows robots.txt, sitemap indexes and gzipped sitemaps, same host only', async () => {
    const urls = await discoverSitemapUrls(`${srv.base}/`);
    expect(urls).toEqual([
      `${srv.base}/article`,
      `${srv.base}/docs`,
      `${srv.base}/docs?lang=en&v=2`,
      `${srv.base}/blog/three`,
      `${srv.base}/blog/one`,
      `${srv.base}/blog/two`,
    ]);
  });

  it('accepts a sitemap URL directly, with limit and filters', async () => {
    expect(await discoverSitemapUrls(`${srv.base}/sitemap.xml`, { limit: 2 })).toHaveLength(2);
    expect(await discoverSitemapUrls(`${srv.base}/sitemap.xml`, { include: /\/blog\// })).toHaveLength(3);
    expect(await discoverSitemapUrls(`${srv.base}/sitemap.xml`, { exclude: /\/blog\/|\?/ })).toEqual([`${srv.base}/article`, `${srv.base}/docs`]);
  });

  it('can include other hosts', async () => {
    expect(await discoverSitemapUrls(`${srv.base}/sitemap-pages.xml`, { sameHost: false })).toContain('https://elsewhere.example/page');
  });
});

describe('fetchMarkdownBatch', () => {
  it('converts many URLs, isolating failures', async () => {
    const urls = [`${srv.base}/article`, `${srv.base}/missing`, `${srv.base}/docs`, `${srv.base}/blog/one`];
    const items: BatchItem[] = [];
    for await (const item of fetchMarkdownBatch(urls, { concurrency: 2 })) items.push(item);
    expect(items).toHaveLength(4);
    const byIndex = items.sort((a, b) => a.index - b.index);
    expect(byIndex.map((i) => i.ok)).toEqual([true, false, true, true]);
    const failed = byIndex[1]!;
    expect(!failed.ok && failed.error.status).toBe(404);
  });

  it('never runs more than `concurrency` requests at once', async () => {
    const original = globalThis.fetch;
    let inFlight = 0;
    let peak = 0;
    const counting: typeof fetch = async (input, init) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 20));
        return await original(input, init);
      } finally {
        inFlight--;
      }
    };
    const urls = Array.from({ length: 8 }, (_, i) => `${srv.base}/blog/one?i=${i}`);
    for await (const item of fetchMarkdownBatch(urls, { concurrency: 3, fetch: counting })) expect(item.ok).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchMarkdown, quanticdataExtract, type UrlToMarkdownError } from '../src';
import { TEST_KEY } from './helpers';
import { startTestServer, type TestServer } from './server';

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());
afterEach(() => {
  vi.unstubAllEnvs();
  srv.apiCalls.length = 0;
});

const useMockApi = () => {
  vi.stubEnv('QUANTICDATA_API_KEY', TEST_KEY);
  vi.stubEnv('QUANTICDATA_API_BASE', srv.apiBase);
};

const errorOf = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as UrlToMarkdownError;

describe('fetchMarkdown (local backend)', () => {
  it('converts a page and reports where it came from', async () => {
    const r = await fetchMarkdown(`${srv.base}/redirect`);
    expect(r.source).toBe('local');
    expect(r.url).toBe(`${srv.base}/redirect`);
    expect(r.finalUrl).toBe(`${srv.base}/article`);
    expect(r.status).toBe(200);
    expect(r.markdown).toContain(`[tide pools](${srv.base}/glossary/tide-pool)`);
  });

  it('explains how to get past a block when --unlock is off', async () => {
    const err = await errorOf(fetchMarkdown(`${srv.base}/challenge`));
    expect(err.kind).toBe('blocked');
    expect(err.status).toBe(403);
    expect(err.message).toContain('--unlock');
    expect(srv.apiCalls).toHaveLength(0);
  });

  it('throws on HTTP errors that are not blocks', async () => {
    const err = await errorOf(fetchMarkdown(`${srv.base}/missing`));
    expect(err.kind).toBe('http');
    expect(err.status).toBe(404);
  });

  it('passes plain text through without a title', async () => {
    const r = await fetchMarkdown(`${srv.base}/plain`);
    expect(r.markdown).toBe('Just text.\n\nSecond paragraph.\n');
  });

  it('refuses binary documents', async () => {
    expect((await errorOf(fetchMarkdown(`${srv.base}/binary`))).kind).toBe('not_html');
  });

  it('keeps a JavaScript shell local when --unlock is off (thin output, no API call)', async () => {
    const r = await fetchMarkdown(`${srv.base}/shell`);
    expect(r.source).toBe('local');
    expect(srv.apiCalls).toHaveLength(0);
  });
});

describe('fetchMarkdown with --unlock', () => {
  it('needs an API key', async () => {
    vi.stubEnv('QUANTICDATA_API_KEY', '');
    expect((await errorOf(fetchMarkdown(`${srv.base}/article`, { unlock: true }))).kind).toBe('config');
  });

  it('does not call the API for pages that convert locally', async () => {
    useMockApi();
    const r = await fetchMarkdown(`${srv.base}/article`, { unlock: true });
    expect(r.source).toBe('local');
    expect(srv.apiCalls).toHaveLength(0);
  });

  it('retries a blocked page through the API with the documented request body', async () => {
    useMockApi();
    const r = await fetchMarkdown(`${srv.base}/challenge`, { unlock: true, images: 'strip', quanticdata: { country: 'us', render: true } });
    expect(r.source).toBe('quanticdata');
    expect(r.markdown).toContain('Rendered by the browser tier');
    expect(srv.apiCalls).toHaveLength(1);
    expect(srv.apiCalls[0]!.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(srv.apiCalls[0]!.body).toEqual({
      url: `${srv.base}/challenge`,
      format: 'markdown',
      contentMode: 'article',
      images_mode: 'strip',
      render: true,
      country: 'us',
    });
  });

  it('retries an empty JavaScript shell through the API', async () => {
    useMockApi();
    const r = await fetchMarkdown(`${srv.base}/shell`, { unlock: true });
    expect(r.source).toBe('quanticdata');
    expect(r.metadata.title).toBe('Dashboard');
  });

  it('reports a page that stays blocked through the API', async () => {
    useMockApi();
    const err = await errorOf(fetchMarkdown(`${srv.base}/always-blocked`, { unlock: true }));
    expect(err.kind).toBe('blocked');
    expect(err.message).toContain('captcha');
  });
});

describe('QuanticData backend', () => {
  it('backend: quanticdata sends every page to the API', async () => {
    useMockApi();
    const r = await fetchMarkdown(`${srv.base}/article`, { backend: 'quanticdata', contentMode: 'full', frontmatter: true });
    expect(r.source).toBe('quanticdata');
    expect(srv.apiCalls[0]!.body.contentMode).toBe('smart');
    expect(r.markdown).toMatch(/^---\n[\s\S]*source: quanticdata\n/);
  });

  it('surfaces the API error message', async () => {
    const err = await errorOf(quanticdataExtract({ url: 'https://example.com' }, { apiKey: 'bad key', baseUrl: srv.apiBase }));
    expect(err.kind).toBe('backend');
    expect(err.status).toBe(401);
    expect(err.message).toContain('Invalid or missing API key');
  });

  it('reports an unreachable API', async () => {
    const err = await errorOf(quanticdataExtract({ url: 'https://example.com' }, { apiKey: TEST_KEY, baseUrl: 'http://127.0.0.1:1/v1' }));
    expect(err.kind).toBe('backend');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPage, type UrlToMarkdownError } from '../src';
import { startTestServer, type TestServer } from './server';

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

const kindOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as UrlToMarkdownError).kind;

describe('fetchPage', () => {
  it('fetches HTML with a descriptive user agent', async () => {
    const page = await fetchPage(`${srv.base}/article`);
    expect(page.status).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body).toContain('How Tide Pools Work');
  });

  it('follows redirects and reports the final URL', async () => {
    const page = await fetchPage(`${srv.base}/redirect`);
    expect(page.finalUrl).toBe(`${srv.base}/article`);
    expect(page.url).toBe(`${srv.base}/redirect`);
  });

  it('stops redirect loops', async () => {
    expect(await kindOf(fetchPage(`${srv.base}/redirect-loop`, { maxRedirects: 3 }))).toBe('redirects');
  });

  it('refuses redirects to non-http schemes', async () => {
    expect(await kindOf(fetchPage(`${srv.base}/redirect-ftp`))).toBe('invalid_url');
  });

  it('times out', async () => {
    expect(await kindOf(fetchPage(`${srv.base}/slow`, { timeoutMs: 100 }))).toBe('timeout');
  });

  it('enforces the size limit', async () => {
    expect(await kindOf(fetchPage(`${srv.base}/big`, { maxBytes: 10_000 }))).toBe('too_large');
  });

  it('decodes the charset declared by the server', async () => {
    const page = await fetchPage(`${srv.base}/latin1`);
    expect(page.body).toContain('Café crème');
  });

  it('returns error statuses instead of throwing', async () => {
    const page = await fetchPage(`${srv.base}/missing`);
    expect(page.status).toBe(404);
  });

  it('rejects non-http URLs up front', async () => {
    expect(await kindOf(fetchPage('file:///etc/passwd'))).toBe('invalid_url');
    expect(await kindOf(fetchPage('not a url'))).toBe('invalid_url');
  });

  it('reports unreachable hosts as network errors', async () => {
    expect(await kindOf(fetchPage('http://127.0.0.1:1/'))).toBe('network');
  });
});

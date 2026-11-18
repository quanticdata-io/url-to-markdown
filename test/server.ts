/**
 * Local test site plus a stand-in for the QuanticData extract endpoint.
 *
 * The test suite starts it on a random port. `npm run demo-server` starts it on
 * http://127.0.0.1:8787 so the README quickstart can be tried without touching
 * the internet. Nothing here forwards requests anywhere.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

export interface RecordedApiCall {
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export interface TestServer {
  base: string;
  apiBase: string;
  apiCalls: RecordedApiCall[];
  hits: Map<string, number>;
  close: () => Promise<void>;
}

const RENDERED_SHELL = `# Dashboard\n\nRendered by the browser tier: 3 widgets, 12 alerts.\n`;

export async function startTestServer(port = 0): Promise<TestServer> {
  const apiCalls: RecordedApiCall[] = [];
  const hits = new Map<string, number>();
  let base = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const html = (status: number, body: string, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    const withBase = (s: string) => s.replaceAll('{{BASE}}', base);

    if (url.pathname === '/v1/scraper/extract' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
        apiCalls.push({ authorization: req.headers.authorization, body });
        res.setHeader('Content-Type', 'application/json');
        if (!/^Bearer qd_(live|test)_[A-Za-z0-9]+$/.test(String(req.headers.authorization ?? ''))) {
          res.statusCode = 401;
          res.end(JSON.stringify({ type: 'error', message: 'Invalid or missing API key' }));
          return;
        }
        const target = String(body.url ?? '');
        if (target.includes('/always-blocked')) {
          res.end(JSON.stringify({ type: 'response', message: 'Extraction successful', payload: { url: target, finalUrl: target, status: 403, format: 'markdown', content: '', blockReason: 'captcha', bytes: 0, durationMs: 1 } }));
          return;
        }
        res.end(
          JSON.stringify({
            type: 'response',
            message: 'Extraction successful',
            payload: {
              url: target,
              finalUrl: target,
              status: 200,
              contentType: 'text/html; charset=utf-8',
              format: 'markdown',
              title: 'Dashboard',
              metadata: { description: 'Rendered remotely', canonical: target, language: 'en' },
              content: RENDERED_SHELL,
              engine: 'render',
              bytes: 1024,
              durationMs: 900,
            },
            pagination: {},
          }),
        );
      });
      return;
    }

    switch (url.pathname) {
      case '/':
      case '/article':
        return html(200, fixture('article.html'));
      case '/docs':
        return html(200, fixture('docs.html'));
      case '/blog/one':
      case '/blog/two':
      case '/blog/three':
        return html(200, `<html><head><title>Post ${url.pathname.slice(6)}</title></head><body><article><h1>Post ${url.pathname.slice(6)}</h1><p>${'Body text of the post. '.repeat(30)}</p></article></body></html>`);
      case '/shell':
        return html(200, fixture('js-shell.html'));
      case '/challenge':
        return html(403, fixture('challenge.html'));
      case '/always-blocked':
        return html(403, fixture('challenge.html'));
      case '/rate-limited':
        return html(429, '<html><body>Too many requests</body></html>');
      case '/missing':
        return html(404, '<html><body>Not found</body></html>');
      case '/redirect':
        res.writeHead(302, { Location: '/article' });
        return res.end();
      case '/redirect-loop':
        res.writeHead(302, { Location: '/redirect-loop' });
        return res.end();
      case '/redirect-ftp':
        res.writeHead(302, { Location: 'ftp://example.com/file' });
        return res.end();
      case '/slow':
        setTimeout(() => html(200, fixture('article.html')), 1500);
        return;
      case '/big':
        return html(200, `<html><body>${'x'.repeat(200_000)}</body></html>`);
      case '/plain':
        return html(200, 'Just text.\n\nSecond paragraph.\n', 'text/plain; charset=utf-8');
      case '/binary':
        return html(200, '%PDF-1.7 binary', 'application/pdf');
      case '/latin1': {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
        return res.end(Buffer.from(`<html><head><title>Caf\xe9</title></head><body><article><h1>Caf\xe9 cr\xe8me</h1><p>${'Cr\xe8me br\xfbl\xe9e et caf\xe9. '.repeat(20)}</p></article></body></html>`, 'latin1'));
      }
      case '/robots.txt':
        return html(200, `User-agent: *\nDisallow:\nSitemap: ${base}/sitemap.xml\n`, 'text/plain');
      case '/sitemap.xml':
        return html(200, withBase(fixture('sitemap-index.xml')), 'application/xml');
      case '/sitemap-pages.xml':
        return html(200, withBase(fixture('sitemap-pages.xml')), 'application/xml');
      case '/sitemap-more.xml.gz':
        res.writeHead(200, { 'Content-Type': 'application/x-gzip' });
        return res.end(gzipSync(withBase(fixture('sitemap-more.xml'))));
      default:
        return html(404, '<html><body>Not found</body></html>');
    }
  });

  await new Promise<void>((resolve) => server.listen({ port, host: '127.0.0.1', backlog: 2048 }, resolve));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  base = `http://127.0.0.1:${actual}`;
  return {
    base,
    apiBase: `${base}/v1`,
    apiCalls,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void startTestServer(Number(process.env.PORT ?? 8787)).then((s) => {
    console.log(`Test site:        ${s.base}  (/article, /docs, /shell, /challenge, /sitemap.xml)`);
    console.log(`Mock QuanticData: ${s.apiBase}  (POST /scraper/extract)`);
  });
}

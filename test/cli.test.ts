import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileNameFor, main } from '../src/cli';
import { VERSION } from '../src';
import { TEST_KEY } from './helpers';
import { startTestServer, type TestServer } from './server';

let srv: TestServer;
let tmp: string;
beforeAll(async () => {
  srv = await startTestServer();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
});
afterAll(async () => {
  await srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.unstubAllEnvs());

async function run(args: string[], stdin = '') {
  let out = '';
  let err = '';
  const code = await main(args, { stdout: (t) => (out += t), stderr: (t) => (err += t), readStdin: async () => stdin });
  return { code, out, err };
}

describe('cli', () => {
  it('prints help and version', async () => {
    expect((await run(['--help'])).out).toContain('Usage');
    expect((await run(['-v'])).out).toBe(`${VERSION}\n`);
  });

  it('converts one URL to stdout', async () => {
    const r = await run([`${srv.base}/article`]);
    expect(r.code).toBe(0);
    expect(r.out.startsWith('# How Tide Pools Work\n')).toBe(true);
  });

  it('converts stdin HTML with a base URL', async () => {
    const r = await run(['-', '--base-url', 'https://s.example/x/'], '<html><body><article><p>Hello <a href="y">there</a>, a paragraph that is long enough.</p></article></body></html>');
    expect(r.code).toBe(0);
    expect(r.out).toContain('[there](https://s.example/x/y)');
  });

  it('converts a local file', async () => {
    const file = path.join(tmp, 'page.html');
    fs.writeFileSync(file, '<html><head><title>Local</title></head><body><main><p>From disk.</p></main></body></html>');
    const r = await run([file, '--no-title']);
    expect(r.out).toBe('From disk.\n');
  });

  it('prints JSON with chunks', async () => {
    const r = await run([`${srv.base}/docs`, '--json', '--chunk', '60']);
    const doc = JSON.parse(r.out) as { title: string; source: string; chunks: { tokens: number }[]; markdown: string };
    expect(doc.title).toBe('Getting started');
    expect(doc.source).toBe('local');
    expect(doc.chunks.length).toBeGreaterThan(1);
  });

  it('streams JSONL for a sitemap, one line per page', async () => {
    const r = await run(['--sitemap', `${srv.base}/sitemap.xml`, '--include', '/blog/', '--jsonl', '-q']);
    expect(r.code).toBe(0);
    const lines = r.out.trim().split('\n').map((l) => JSON.parse(l) as { url: string; markdown: string });
    expect(lines.map((l) => l.url).sort()).toEqual([`${srv.base}/blog/one`, `${srv.base}/blog/three`, `${srv.base}/blog/two`]);
  });

  it('writes one file per page to a directory and reports failures with exit 1', async () => {
    const list = path.join(tmp, 'urls.txt');
    fs.writeFileSync(list, `# pages\n${srv.base}/article\n${srv.base}/docs\n${srv.base}/missing\n`);
    const out = path.join(tmp, 'out');
    const r = await run(['-i', list, '-o', out, '--frontmatter']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('[3/3]');
    expect(r.err).toContain('fail');
    const files = fs.readdirSync(out).sort();
    expect(files).toEqual(['127.0.0.1_article.md', '127.0.0.1_docs.md']);
    expect(fs.readFileSync(path.join(out, files[0]!), 'utf8')).toMatch(/^---\ntitle: How Tide Pools Work/);
  });

  it('uses the QuanticData backend with --unlock', async () => {
    vi.stubEnv('QUANTICDATA_API_KEY', TEST_KEY);
    vi.stubEnv('QUANTICDATA_API_BASE', srv.apiBase);
    const r = await run([`${srv.base}/challenge`, '--unlock', '--country', 'de']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Rendered by the browser tier');
    expect(srv.apiCalls.at(-1)!.body.country).toBe('de');
  });

  it('reports a blocked page with exit 1 and a hint', async () => {
    const r = await run([`${srv.base}/challenge`]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--unlock');
  });

  it.each([
    [[], 'no input'],
    [['--mode', 'everything', 'https://e.example'], '--mode must be one of'],
    [['--chunk', '100', 'https://e.example'], '--chunk needs --json or --jsonl'],
    [['https://a.example', 'https://b.example'], 'several inputs'],
    [['--nope'], 'Unknown option'],
    [['missing-file.html'], 'neither an http(s) URL nor a readable file'],
  ])('exits 2 on usage errors: %j', async (args, message) => {
    const r = await run(args as string[]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
  });

  it('builds safe, unique file names', () => {
    const used = new Set<string>();
    expect(fileNameFor('https://e.example/docs/intro.html', used)).toBe('e.example_docs_intro.md');
    expect(fileNameFor('https://e.example/docs/intro.html', used)).toBe('e.example_docs_intro-2.md');
    expect(fileNameFor('https://e.example/', used)).toBe('e.example.md');
    expect(fileNameFor('https://e.example/a?b=1&c=2', used)).toBe('e.example_a_b_1_c_2.md');
  });
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fetchMarkdownBatch } from './batch';
import { UrlToMarkdownError } from './errors';
import { convertHtml } from './markdown';
import { discoverSitemapUrls } from './sitemap';
import type { Backend, ContentMode, FetchMarkdownOptions, ImagesMode, LinksMode, MarkdownResult } from './types';
import { VERSION } from './version';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
}

const HELP = `url-to-markdown ${VERSION}
Turn web pages into clean Markdown for LLMs. Runs locally, no API key needed.

Usage
  url-to-markdown [options] <url | file.html | -> [more ...]

Input
  <url>                    http(s) URL to fetch and convert
  <file.html>              local HTML file (use --base-url to resolve its links)
  -                        read HTML from stdin
  -i, --input <file>       read URLs from a file, one per line ('#' starts a comment)
  --sitemap <url>          convert the pages listed in a site's sitemap(s)
  --limit <n>              max pages taken from --sitemap (default 100)
  --include <regex>        keep only sitemap URLs matching the pattern
  --exclude <regex>        drop sitemap URLs matching the pattern
  --base-url <url>         base URL for file and stdin input

Output
  -o, --out <path>         output file (one input) or directory (several inputs)
  --json                   print one JSON object per input (an array for several)
  --jsonl                  print one JSON object per line
  --frontmatter            start each document with YAML frontmatter
  --no-title               do not add a "# Title" heading
  --mode <article|full>    main article only (default) or the whole page
  --images <inline|alt|strip>    default inline
  --links <inline|footnote|strip>  default inline
  --chunk <tokens>         add RAG chunks of at most <tokens> (with --json/--jsonl)

Fetching
  --timeout <ms>           per-request timeout (default 30000)
  -H, --header <k: v>      extra request header (repeatable)
  --user-agent <ua>        override the User-Agent
  --concurrency <n>        pages fetched at once (default 4)
  --delay <ms>             pause between requests to the same host (default 0)

QuanticData backend (optional, needs QUANTICDATA_API_KEY)
  --unlock                 retry blocked pages and JavaScript-only pages through the API
  --backend <local|quanticdata>  send every page through the API with "quanticdata"
  --render                 force the API's headless browser
  --country <code>         exit country for the API, e.g. us
  --wait-for <selector>    wait for a CSS selector (API browser)

Other
  -q, --quiet              no progress on stderr
  -v, --version            print the version
  -h, --help               print this help

Exit status: 0 all pages converted, 1 some pages failed, 2 usage error.
`;

class UsageError extends Error {}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function positiveInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a non-negative integer`);
  return n;
}

function regex(name: string, value: string | undefined): RegExp | undefined {
  if (value === undefined) return undefined;
  try {
    return new RegExp(value);
  } catch {
    throw new UsageError(`--${name} is not a valid regular expression`);
  }
}

/** File name for a URL inside an output directory. */
export function fileNameFor(url: string, used: Set<string>): string {
  let base: string;
  try {
    const u = new URL(url);
    base = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').replace(/\.(html?|php|aspx?)$/i, '');
    if (u.search) base += `_${u.search.slice(1)}`;
  } catch {
    base = path.basename(url).replace(/\.[^.]+$/, '');
  }
  base = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 150) || 'page';
  let name = `${base}.md`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}-${i}.md`;
  used.add(name.toLowerCase());
  return name;
}

function toJson(r: MarkdownResult): Record<string, unknown> {
  return {
    url: r.url,
    final_url: r.finalUrl,
    status: r.status,
    source: r.source,
    title: r.metadata.title,
    description: r.metadata.description,
    language: r.metadata.language,
    fetched_at: r.fetchedAt,
    tokens: r.tokens,
    markdown: r.markdown,
    ...(r.chunks ? { chunks: r.chunks } : {}),
  };
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (err) {
    io.stderr(`url-to-markdown: ${(err as Error).message}\nRun "url-to-markdown --help" for usage.\n`);
    return 2;
  }
  const { values: v, positionals } = args;
  if (v.help) {
    io.stdout(HELP);
    return 0;
  }
  if (v.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  try {
    const headers: Record<string, string> = {};
    for (const h of v.header ?? []) {
      const i = h.indexOf(':');
      if (i <= 0) throw new UsageError(`--header must look like "Name: value", got "${h}"`);
      headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
    }
    const chunkTokens = positiveInt('chunk', v.chunk);
    if (chunkTokens !== undefined && !v.json && !v.jsonl) throw new UsageError('--chunk needs --json or --jsonl');
    if (v.json && v.jsonl) throw new UsageError('use either --json or --jsonl');

    const opts: FetchMarkdownOptions & { concurrency?: number; delayMs?: number } = {
      contentMode: oneOf<ContentMode>('mode', v.mode, ['article', 'full']),
      images: oneOf<ImagesMode>('images', v.images, ['inline', 'alt', 'strip']),
      links: oneOf<LinksMode>('links', v.links, ['inline', 'footnote', 'strip']),
      frontmatter: v.frontmatter ?? false,
      title: !v['no-title'],
      chunkTokens,
      timeoutMs: positiveInt('timeout', v.timeout),
      headers,
      userAgent: v['user-agent'],
      backend: oneOf<Backend>('backend', v.backend, ['local', 'quanticdata']),
      unlock: v.unlock ?? false,
      concurrency: positiveInt('concurrency', v.concurrency),
      delayMs: positiveInt('delay', v.delay),
      quanticdata: {
        render: v.render,
        country: v.country,
        waitForSelector: v['wait-for'],
      },
    };

    // Collect inputs: URLs, local files, stdin.
    const urls: string[] = [];
    const local: { name: string; html: string }[] = [];
    for (const p of positionals) {
      if (p === '-') local.push({ name: 'stdin', html: await io.readStdin() });
      else if (/^https?:\/\//i.test(p)) urls.push(p);
      else {
        const html = await fs.readFile(p, 'utf8').catch(() => {
          throw new UsageError(`"${p}" is neither an http(s) URL nor a readable file`);
        });
        local.push({ name: p, html });
      }
    }
    if (v.input) {
      const text = await fs.readFile(v.input, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const t = line.replace(/#.*$/, '').trim();
        if (t) urls.push(t);
      }
    }
    if (v.sitemap) {
      const found = await discoverSitemapUrls(v.sitemap, {
        limit: positiveInt('limit', v.limit) ?? 100,
        include: regex('include', v.include),
        exclude: regex('exclude', v.exclude),
        timeoutMs: opts.timeoutMs,
        headers,
        userAgent: opts.userAgent,
      });
      if (!v.quiet) io.stderr(`sitemap: ${found.length} page(s)\n`);
      urls.push(...found);
    }
    const total = urls.length + local.length;
    if (total === 0) throw new UsageError('no input: give a URL, a file, "-", --input or --sitemap');
    if (total > 1 && !v.out && !v.json && !v.jsonl) throw new UsageError('several inputs: use --out <dir>, --json or --jsonl');

    const results: { name: string; result?: MarkdownResult; error?: Error }[] = [];
    for (const l of local) {
      try {
        results.push({ name: l.name, result: convertHtml(l.html, { ...opts, url: v['base-url'] }) });
      } catch (err) {
        results.push({ name: l.name, error: err as Error });
      }
    }
    if (v.jsonl && !v.out) {
      for (const r of results) io.stdout(JSON.stringify(r.result ? toJson(r.result) : { input: r.name, error: r.error?.message }) + '\n');
    }
    let done = 0;
    const ordered: { name: string; result?: MarkdownResult; error?: Error }[] = new Array(urls.length);
    for await (const item of fetchMarkdownBatch(urls, opts)) {
      done++;
      if (item.ok) ordered[item.index] = { name: item.url, result: item.result };
      else ordered[item.index] = { name: item.url, error: item.error };
      if (!v.quiet && urls.length > 1) {
        io.stderr(`[${done}/${urls.length}] ${item.ok ? 'ok  ' : 'fail'} ${item.url}${item.ok ? '' : `: ${item.error.message}`}\n`);
      }
      if (v.jsonl && !v.out) {
        io.stdout(JSON.stringify(item.ok ? toJson(item.result) : { url: item.url, error: item.error.message, kind: item.error.kind }) + '\n');
      }
    }
    results.push(...ordered);

    const failures = results.filter((r) => r.error);
    if (v.jsonl && !v.out) {
      // Already streamed above, one line per document.
    } else if (v.json && !v.out) {
      const docs = results.map((r) => (r.result ? toJson(r.result) : { url: r.name, error: r.error?.message }));
      io.stdout(JSON.stringify(total === 1 ? docs[0] : docs, null, 2) + '\n');
    } else if (v.out) {
      const multi = total > 1 || (await fs.stat(v.out).then((s) => s.isDirectory()).catch(() => false));
      if (multi) {
        await fs.mkdir(v.out, { recursive: true });
        const used = new Set<string>();
        for (const r of results) {
          if (!r.result) continue;
          const name = fileNameFor(r.result.finalUrl ?? r.name, used).replace(/\.md$/, v.json || v.jsonl ? '.json' : '.md');
          const body = v.json || v.jsonl ? JSON.stringify(toJson(r.result), null, 2) + '\n' : r.result.markdown;
          await fs.writeFile(path.join(v.out, name), body, 'utf8');
        }
      } else if (results[0]?.result) {
        const r = results[0].result;
        await fs.mkdir(path.dirname(path.resolve(v.out)), { recursive: true });
        await fs.writeFile(v.out, v.json || v.jsonl ? JSON.stringify(toJson(r), null, 2) + '\n' : r.markdown, 'utf8');
      }
      if (!v.quiet) io.stderr(`wrote ${results.length - failures.length} document(s) to ${v.out}\n`);
    } else if (results[0]?.result) {
      io.stdout(results[0].result.markdown);
    }

    // With several URLs the progress lines already reported each failure.
    const progressShown = !v.quiet && urls.length > 1;
    for (const f of failures) {
      if (!progressShown || !urls.includes(f.name)) io.stderr(`url-to-markdown: ${f.error!.message}\n`);
    }
    return failures.length ? 1 : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`url-to-markdown: ${err.message}\nRun "url-to-markdown --help" for usage.\n`);
      return 2;
    }
    if (err instanceof UrlToMarkdownError) {
      io.stderr(`url-to-markdown: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      input: { type: 'string', short: 'i' },
      sitemap: { type: 'string' },
      limit: { type: 'string' },
      include: { type: 'string' },
      exclude: { type: 'string' },
      'base-url': { type: 'string' },
      out: { type: 'string', short: 'o' },
      json: { type: 'boolean' },
      jsonl: { type: 'boolean' },
      frontmatter: { type: 'boolean' },
      'no-title': { type: 'boolean' },
      mode: { type: 'string' },
      images: { type: 'string' },
      links: { type: 'string' },
      chunk: { type: 'string' },
      timeout: { type: 'string' },
      header: { type: 'string', short: 'H', multiple: true },
      'user-agent': { type: 'string' },
      concurrency: { type: 'string' },
      delay: { type: 'string' },
      unlock: { type: 'boolean' },
      backend: { type: 'string' },
      render: { type: 'boolean' },
      country: { type: 'string' },
      'wait-for': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

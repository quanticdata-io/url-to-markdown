# url-to-markdown

Turn any web page into clean Markdown for LLMs, RAG pipelines and notes. One command, runs on your machine, no API key.

```bash
npx @quanticdata/url-to-markdown https://example.com/blog/post
```

- **Main content only.** Navigation, sidebars, footers, cookie banners and scripts are dropped; the article is kept (readability), or the whole page with `--mode full`.
- **Markdown that survives a model.** GitHub-flavoured tables, fenced code blocks that keep their language, absolute links and images, lazy-loaded images resolved, optional footnote links.
- **Built for pipelines.** YAML frontmatter, token estimate, heading-aware chunks for RAG, JSON and JSONL output, batch mode with bounded concurrency, sitemap discovery (robots.txt, sitemap indexes, gzipped sitemaps).
- **An honest way past blocks.** When a site answers with a challenge page, a 403/429, or an empty JavaScript shell, `--unlock` fetches that one page through the [QuanticData](https://quanticdata.io) API instead. Everything else stays local.

Library and CLI, TypeScript types included, ESM and CommonJS, Node.js 18.17 or newer.

## Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [CLI](#cli)
- [Library](#library)
- [Local mode and the QuanticData backend](#local-mode-and-the-quanticdata-backend)
- [How it works](#how-it-works)
- [Limits](#limits)
- [Development](#development)

## Install

```bash
npm install -g @quanticdata/url-to-markdown   # CLI: url-to-markdown
npm install @quanticdata/url-to-markdown      # library
```

Or run it once with `npx @quanticdata/url-to-markdown <url>`.

## Quickstart

Convert one page to stdout:

```bash
url-to-markdown https://example.com/docs/getting-started
```

Save it with frontmatter:

```bash
url-to-markdown https://example.com/docs/getting-started --frontmatter -o getting-started.md
```

A whole site, from its sitemap, one JSON object per page with RAG chunks of at most 500 tokens:

```bash
url-to-markdown --sitemap https://example.com --limit 200 --jsonl --chunk 500 > site.jsonl
```

HTML you already have (stdin or a file):

```bash
curl -s https://example.com/page | url-to-markdown - --base-url https://example.com/page
url-to-markdown saved-page.html --base-url https://example.com/page
```

### Try it without the internet

The repository ships the local test site used by the test suite, with a stand-in for the QuanticData endpoint:

```bash
git clone https://github.com/quanticdata-io/url-to-markdown && cd url-to-markdown
npm ci && npm run build
npm run demo-server &          # http://127.0.0.1:8787

node dist/cli.js http://127.0.0.1:8787/docs
node dist/cli.js --sitemap http://127.0.0.1:8787 --jsonl -q | head -c 400
node dist/cli.js http://127.0.0.1:8787/challenge          # blocked: exit 1 with a hint

QUANTICDATA_API_KEY=qd_test_demo QUANTICDATA_API_BASE=http://127.0.0.1:8787/v1 \
  node dist/cli.js http://127.0.0.1:8787/challenge --unlock  # goes through the local stand-in
```

## CLI

```
url-to-markdown [options] <url | file.html | -> [more ...]
```

| Option | What it does |
| --- | --- |
| `-i, --input <file>` | Read URLs from a file, one per line (`#` starts a comment). |
| `--sitemap <url>` | Convert the pages listed in a site's sitemaps. Pass the site (robots.txt `Sitemap:` lines, then `/sitemap.xml`) or a sitemap URL. |
| `--limit <n>` | Pages taken from `--sitemap` (default 100). |
| `--include <regex>`, `--exclude <regex>` | Filter sitemap URLs. |
| `--base-url <url>` | Base for file and stdin input. |
| `-o, --out <path>` | Output file (one input) or directory (several inputs, one `.md` per page). |
| `--json`, `--jsonl` | JSON output: an object (or array) or one object per line, streamed as pages finish. |
| `--frontmatter` | YAML frontmatter: title, url, description, site name, author, language, published, fetched_at, source, tokens. |
| `--no-title` | Do not add a `# Title` heading. |
| `--mode <article\|full>` | Main article (default) or the whole page minus chrome. |
| `--images <inline\|alt\|strip>` | Keep images, keep only their alt text, or drop them. |
| `--links <inline\|footnote\|strip>` | Inline links, numbered footnotes, or plain text. |
| `--chunk <tokens>` | Add heading-aware chunks (with `--json` or `--jsonl`). |
| `--timeout <ms>` | Per-request timeout (default 30000). |
| `-H, --header "Name: value"` | Extra request header, repeatable. |
| `--user-agent <ua>` | Override the User-Agent. |
| `--concurrency <n>` | Pages fetched at once (default 4). |
| `--delay <ms>` | Pause between two requests to the same host. |
| `--unlock` | Retry blocked and JavaScript-only pages through the QuanticData API. |
| `--backend <local\|quanticdata>` | `quanticdata` sends every page through the API. |
| `--render`, `--country <code>`, `--wait-for <selector>` | Options of the QuanticData backend: browser rendering, exit country, wait for an element. |
| `-q, --quiet` | No progress lines on stderr. |

Exit status: `0` every page converted, `1` at least one page failed (the others are still written), `2` usage error.

JSON objects have `url`, `final_url`, `status`, `source` (`local` or `quanticdata`), `title`, `description`, `language`, `fetched_at`, `tokens`, `markdown` and, with `--chunk`, `chunks[]` (`index`, `headings`, `content`, `tokens`).

## Library

```ts
import { convertHtml, fetchMarkdown, fetchMarkdownBatch, discoverSitemapUrls, chunkMarkdown } from '@quanticdata/url-to-markdown';

// HTML you already have: nothing is fetched.
const doc = convertHtml(html, { url: 'https://example.com/post', frontmatter: true });
console.log(doc.metadata.title, doc.tokens);
console.log(doc.markdown);

// Fetch and convert.
const page = await fetchMarkdown('https://example.com/docs', { links: 'footnote', chunkTokens: 400 });
for (const chunk of page.chunks ?? []) console.log(chunk.headings.join(' > '), chunk.tokens);

// Many pages, four at a time, failures isolated.
const urls = await discoverSitemapUrls('https://example.com', { limit: 50, include: /\/docs\// });
for await (const item of fetchMarkdownBatch(urls, { concurrency: 4 })) {
  if (item.ok) console.log(item.url, item.result.tokens);
  else console.error(item.url, item.error.kind, item.error.message);
}
```

Every failure is a `UrlToMarkdownError` with a `kind`: `http`, `blocked`, `timeout`, `network`, `too_large`, `not_html`, `redirects`, `invalid_url`, `backend` or `config`, plus `url` and `status`.

The building blocks are exported too: `extractContent`, `htmlToMarkdown`, `detectBlock`, `isJavaScriptShell`, `estimateTokens`, `chunkMarkdown`, `parseSitemap`, `fetchPage`, `quanticdataExtract`.

## Local mode and the QuanticData backend

| | Local (default) | QuanticData backend |
| --- | --- | --- |
| Needs | Nothing | An API key (`QUANTICDATA_API_KEY`) |
| Where the page is fetched | Your machine, your IP | QuanticData, through rotating residential exits |
| JavaScript-rendered pages | Not executed: an empty app shell gives little text | Rendered in a headless browser when needed (`--render` forces it) |
| Anti-bot challenges, 403/429 | Reported as `blocked` | Handled by the API |
| Geo-specific content | Your location | `--country` |
| Conversion | This library | The API's own Markdown converter (`POST /scraper/extract`) |
| Cost | Free | Pay per successful page: see [pricing](https://quanticdata.io/pricing/) |

`--unlock` combines the two: every page is first tried locally, and only pages that come back blocked or as an empty JavaScript shell are sent to the API, so you pay only for the pages you could not read yourself. With `--backend quanticdata` every page goes through the API.

The backend calls `POST https://api.quanticdata.io/v1/scraper/extract` with `Authorization: Bearer $QUANTICDATA_API_KEY` and the body fields `url`, `format: "markdown"`, `contentMode`, and when given `images_mode`, `links_mode`, `render`, `country`, `waitForSelector`, `mobile`, as documented in the [API reference](https://quanticdata.io/docs/). `QUANTICDATA_API_BASE` overrides the base URL. Keys are created on the API keys page of the QuanticData dashboard.

## How it works

1. **Fetch.** Browser-like `Accept` headers, a descriptive User-Agent, manual redirects (only to http and https), a timeout, a 10 MiB size limit, charset from the header or the `<meta charset>`, and retries for connections that fail before any response.
2. **Detect.** A challenge page, a 403/429/503 or an empty JavaScript shell is recognised before conversion, so you get a clear `blocked` error (or an `--unlock` retry) instead of Markdown made of a captcha.
3. **Extract.** Code-block languages and lazy image sources are normalised, links and images resolved against the final URL (and `<base href>`), cookie and consent banners removed, then the main content is selected with Mozilla's readability. Pages it cannot score fall back to `<main>`, `<article>` or the body.
4. **Convert.** HTML to GitHub-flavoured Markdown: ATX headings, `-` lists, fenced code with language and a fence longer than any backtick run inside, GFM tables, escaped link destinations, numbered footnotes on request.
5. **Package.** Title heading, YAML frontmatter, token estimate, chunks.

Token counts are estimates (characters and words, wide scripts counted per character), meant for budgets and chunk sizes.

## Limits

- Local mode does not run JavaScript. For single-page apps use `--unlock` or `--backend quanticdata`.
- PDF and other binary documents are refused (`not_html`) in this version.
- Respect each site's terms and robots rules; `--delay` and `--concurrency` keep the load reasonable.

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build && npm run check:package
```

Tests run against a local HTTP server (`test/server.ts`) with HTML fixtures and a stand-in for the QuanticData endpoint: they never touch the internet or the paid API. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Content extraction uses [@mozilla/readability](https://github.com/mozilla/readability) (Apache-2.0); conversion uses [turndown](https://github.com/mixmark-io/turndown) (MIT).

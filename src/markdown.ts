import { hasQuanticDataKey, quanticdataExtract } from './backend/quanticdata';
import { chunkMarkdown } from './chunk';
import { htmlToMarkdown, tidyMarkdown } from './convert';
import { detectBlock, isJavaScriptShell } from './detect';
import { UrlToMarkdownError } from './errors';
import { extractContent } from './extract';
import { fetchPage } from './fetch';
import { renderFrontmatter } from './frontmatter';
import { estimateTokens } from './tokens';
import type { ConvertOptions, FetchMarkdownOptions, MarkdownResult, PageMetadata, Source } from './types';

const HTML_TYPES = /(text\/html|application\/xhtml\+xml)/i;
const TEXT_TYPES = /(text\/plain|text\/markdown|text\/x-markdown)/i;

function escapeHeading(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/** Puts `# Title` first: promotes a leading heading that matches the title, or prepends one. */
function withTitle(md: string, title: string | undefined): string {
  if (!title) return md;
  const t = escapeHeading(title);
  const first = /^(#{1,6})\s+(.+)\n/.exec(md);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (first && norm(first[2]!) === norm(t)) return `# ${first[2]}\n${md.slice(first[0].length)}`;
  if (first?.[1] === '#') return md;
  return `# ${t}\n\n${md}`;
}

function finish(
  body: string,
  meta: PageMetadata,
  opts: ConvertOptions,
  info: { url?: string; finalUrl?: string; status?: number; source: Source },
): MarkdownResult {
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  let content = tidyMarkdown(opts.title === false ? body : withTitle(body, meta.title));
  const tokens = estimateTokens(content);
  if (opts.frontmatter) {
    content =
      renderFrontmatter({
        title: meta.title,
        url: info.finalUrl ?? info.url ?? opts.url,
        description: meta.description,
        site_name: meta.siteName,
        author: meta.byline,
        language: meta.language,
        published: meta.publishedTime,
        fetched_at: fetchedAt,
        source: info.source,
        tokens,
      }) + content;
  }
  return {
    url: info.url ?? opts.url,
    finalUrl: info.finalUrl,
    status: info.status,
    metadata: meta,
    markdown: content,
    tokens: estimateTokens(content),
    source: info.source,
    fetchedAt,
    chunks: opts.chunkTokens ? chunkMarkdown(content, opts.chunkTokens) : undefined,
  };
}

/** Converts an HTML document (or fragment) to Markdown. Nothing is fetched. */
export function convertHtml(html: string, opts: ConvertOptions = {}): MarkdownResult {
  const { metadata, html: content } = extractContent(html, { url: opts.url, contentMode: opts.contentMode });
  const body = htmlToMarkdown(content, { images: opts.images, links: opts.links });
  return finish(body, metadata, opts, { url: opts.url, source: 'local' });
}

async function viaBackend(url: string, opts: FetchMarkdownOptions): Promise<MarkdownResult> {
  const r = await quanticdataExtract({ url, contentMode: opts.contentMode, images: opts.images, links: opts.links }, opts.quanticdata);
  const meta: PageMetadata = { title: r.title, description: r.description, language: r.language, canonical: r.canonical };
  return finish(r.content, meta, opts, { url, finalUrl: r.finalUrl, status: r.status, source: 'quanticdata' });
}

/**
 * Fetches a URL and returns it as Markdown.
 *
 * With `backend: 'local'` (default) the page is fetched and converted on this
 * machine. With `unlock: true`, a page that answers 403/429/503 with a block,
 * shows a challenge or is an empty JavaScript shell is fetched again through
 * the QuanticData API. With `backend: 'quanticdata'` every page goes through the API.
 */
export async function fetchMarkdown(url: string, opts: FetchMarkdownOptions = {}): Promise<MarkdownResult> {
  if (opts.backend === 'quanticdata') return viaBackend(url, opts);
  if (opts.unlock && !hasQuanticDataKey(opts.quanticdata)) {
    throw new UrlToMarkdownError('--unlock needs a QuanticData API key: set QUANTICDATA_API_KEY.', 'config', { url });
  }

  const page = await fetchPage(url, opts);
  const block = detectBlock(page.status, page.body);
  if (block) {
    if (opts.unlock) return viaBackend(url, opts);
    throw new UrlToMarkdownError(
      `Blocked (${block}, HTTP ${page.status}): ${url}. Retry with --unlock to fetch it through the QuanticData API.`,
      'blocked',
      { url, status: page.status },
    );
  }
  if (page.status >= 400) {
    throw new UrlToMarkdownError(`HTTP ${page.status} for ${url}`, 'http', { url, status: page.status });
  }

  if (TEXT_TYPES.test(page.contentType)) {
    return finish(page.body, {}, { ...opts, title: false }, { url, finalUrl: page.finalUrl, status: page.status, source: 'local' });
  }
  if (page.contentType && !HTML_TYPES.test(page.contentType) && !/<html|<body|<!doctype html/i.test(page.body.slice(0, 1024))) {
    throw new UrlToMarkdownError(`Not an HTML page (${page.contentType}): ${url}`, 'not_html', { url, status: page.status });
  }

  const result = convertHtml(page.body, { ...opts, url: page.finalUrl });
  const thin = estimateTokens(result.markdown) < 60;
  if (opts.unlock && thin && isJavaScriptShell(page.body)) return viaBackend(url, opts);
  return { ...result, url, finalUrl: page.finalUrl, status: page.status };
}

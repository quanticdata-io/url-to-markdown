import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ContentMode, PageMetadata } from './types';

export interface Extracted {
  metadata: PageMetadata;
  /** HTML of the content to convert. */
  html: string;
}

type Doc = ReturnType<typeof parseHTML>['document'];
type El = ReturnType<Doc['createElement']>;

/** Elements that never carry page content. */
const NOISE = 'script, style, noscript, template, iframe, svg, canvas, form, button, input, select, textarea, dialog';
/** Page chrome removed in `full` mode. */
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .cookie, .cookies, #cookie-banner, .skip-link';

function meta(doc: Doc, ...names: string[]): string | undefined {
  for (const name of names) {
    const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return undefined;
}

function readMetadata(doc: Doc, baseUrl: string | undefined): PageMetadata {
  const title = meta(doc, 'og:title', 'twitter:title');
  const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
  let canonical: string | undefined;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, baseUrl).href;
    } catch {
      canonical = canonicalHref;
    }
  }
  return {
    title: title || undefined,
    description: meta(doc, 'description', 'og:description', 'twitter:description'),
    siteName: meta(doc, 'og:site_name', 'application-name'),
    byline: meta(doc, 'author', 'article:author'),
    language: doc.documentElement?.getAttribute('lang') ?? meta(doc, 'og:locale'),
    canonical,
    publishedTime: meta(doc, 'article:published_time', 'datePublished', 'date'),
  };
}

const LANG_PATTERNS = [/(?:^|\s)(?:language|lang)-([\w+#.-]+)/i, /(?:^|\s)highlight-(?:source-)?([\w+#.-]+)/i, /(?:^|\s)brush:\s*([\w+#.-]+)/i];

function languageOf(el: El | null | undefined): string | undefined {
  if (!el) return undefined;
  const data = el.getAttribute('data-lang') ?? el.getAttribute('data-language');
  if (data) return data.toLowerCase();
  const cls = el.getAttribute('class') ?? '';
  for (const re of LANG_PATTERNS) {
    const m = re.exec(cls);
    if (m?.[1] && !/^(none|plain|text|plaintext)$/i.test(m[1])) return m[1].toLowerCase();
  }
  return undefined;
}

/**
 * Normalises markup before extraction: code-block languages are copied to
 * `data-language` on <pre> (readability drops classes), relative links and
 * images become absolute, lazy-loaded image sources are promoted.
 */
function normalise(doc: Doc, baseUrl: string | undefined): void {
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    const lang = languageOf(pre) ?? languageOf(pre.querySelector('code')) ?? languageOf(pre.parentElement);
    if (lang) pre.setAttribute('data-language', lang);
  }
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const lazy = img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? img.getAttribute('data-original');
    const src = img.getAttribute('src');
    if (lazy && (!src || src.startsWith('data:'))) img.setAttribute('src', lazy);
    if (!img.getAttribute('src')) {
      const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
      const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) img.setAttribute('src', first);
    }
  }
  if (!baseUrl) return;
  const resolve = (value: string | null): string | null => {
    if (!value || value.startsWith('#') || /^(data|mailto|tel|javascript):/i.test(value)) return value;
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  };
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const v = resolve(a.getAttribute('href'));
    if (v !== null) a.setAttribute('href', v);
  }
  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const v = resolve(img.getAttribute('src'));
    if (v !== null) img.setAttribute('src', v);
  }
}

/**
 * The page title without the site-name suffix: the single <h1> when the
 * <title> contains it ("Getting started - Docs" -> "Getting started"), else the <title>.
 */
function pageTitle(doc: Doc): string | undefined {
  const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined;
  const title = clean(doc.querySelector('title')?.textContent);
  const h1s = Array.from(doc.querySelectorAll('h1'));
  const h1 = h1s.length === 1 ? clean(h1s[0]!.textContent) : undefined;
  if (h1 && (!title || title.toLowerCase().includes(h1.toLowerCase()))) return h1;
  return title ?? h1;
}

const CONSENT = /(^|[\s_-])(cookie|cookies|consent|gdpr|cmp)([\s_-]|$)/i;

/** Removes cookie and consent banners, which readability sometimes keeps. */
function removeConsentBanners(doc: Doc): void {
  for (const el of Array.from(doc.querySelectorAll('[class], [id]'))) {
    if (el.tagName === 'BODY' || el.tagName === 'HTML' || el.tagName === 'MAIN' || el.tagName === 'ARTICLE') continue;
    if (CONSENT.test(el.getAttribute('class') ?? '') || CONSENT.test(el.getAttribute('id') ?? '')) el.remove();
  }
}

function removeAll(root: Doc | El, selector: string): void {
  for (const el of Array.from(root.querySelectorAll(selector))) el.remove();
}

/** Parses a page and returns its metadata and the HTML of its content. */
export function extractContent(html: string, opts: { url?: string; contentMode?: ContentMode } = {}): Extracted {
  // A fragment (no <html>/<head>/<body>) is already content: wrap it and skip readability.
  const fragment = !/<(html|head|body)[\s>]/i.test(html);
  const { document } = parseHTML(fragment ? `<!doctype html><html><head></head><body>${html}</body></html>` : html);
  const doc = document as Doc;
  if (fragment) opts = { ...opts, contentMode: 'full' };
  const base = doc.querySelector('base[href]')?.getAttribute('href');
  const baseUrl = opts.url ? (base ? new URL(base, opts.url).href : opts.url) : base ?? undefined;
  const metadata = readMetadata(doc, baseUrl);
  const documentTitle = pageTitle(doc);
  normalise(doc, baseUrl);
  removeConsentBanners(doc);

  if ((opts.contentMode ?? 'article') === 'article') {
    const clone = parseHTML(doc.toString()).document as Doc;
    removeAll(clone, 'script, style, noscript, template');
    // Site chrome outside the content: readability usually drops it, but not on short pages.
    for (const el of Array.from(clone.querySelectorAll('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]'))) {
      if (!el.closest('article, main, [role="main"]')) el.remove();
    }
    try {
      const article = new Readability(clone as unknown as Document, { charThreshold: 200 }).parse();
      if (article?.content && (article.textContent ?? '').trim().length > 0) {
        return {
          metadata: {
            ...metadata,
            title: metadata.title ?? documentTitle ?? (article.title || undefined),
            byline: metadata.byline ?? article.byline ?? undefined,
            siteName: metadata.siteName ?? article.siteName ?? undefined,
            description: metadata.description ?? article.excerpt ?? undefined,
          },
          html: article.content,
        };
      }
    } catch {
      // fall through to the full-body extraction
    }
  }

  const body = (doc.body ?? doc.documentElement) as El;
  removeAll(body, NOISE);
  removeAll(body, CHROME);
  // `full` keeps the whole body; an `article` request that readability could not
  // serve falls back to the page's <main> (or <article>) when there is one.
  const root = (opts.contentMode ?? 'article') === 'full' ? body : ((body.querySelector('main, [role="main"], article') as El | null) ?? body);
  return { metadata: { ...metadata, title: metadata.title ?? documentTitle }, html: root.innerHTML };
}

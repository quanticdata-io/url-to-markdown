import { describe, expect, it } from 'vitest';
import { convertHtml, htmlToMarkdown, renderFrontmatter, tidyMarkdown } from '../src';
import { FIXED_TIME, readFixture } from './helpers';

const article = readFixture('article.html');
const docs = readFixture('docs.html');

describe('convertHtml: article page', () => {
  const r = convertHtml(article, { url: 'https://site.example/guides/tide-pools', fetchedAt: FIXED_TIME });

  it('keeps the article and drops navigation, sidebar, footer and cookie banner', () => {
    expect(r.markdown).toContain('Twice a day the ocean pulls back');
    expect(r.markdown).toContain('## Zones of the shore');
    expect(r.markdown).not.toMatch(/Unrelated post|Copyright Coastal Notes|We use cookies|About/);
    expect(r.markdown).not.toContain('window.analytics');
  });

  it('starts with the page title as a level-1 heading, once', () => {
    expect(r.markdown.startsWith('# How Tide Pools Work\n')).toBe(true);
    expect(r.markdown.match(/^# /gm)).toHaveLength(1);
  });

  it('resolves relative links and images, and promotes lazy image sources', () => {
    expect(r.markdown).toContain('[tide pools](https://site.example/glossary/tide-pool)');
    expect(r.markdown).toContain('![A tide pool with anemones](https://site.example/img/pool.jpg "Low tide")');
    expect(r.markdown).toContain('![map of the coast](https://site.example/img/lazy-map.png)');
    expect(r.markdown).not.toContain('data:image');
  });

  it('reads page metadata', () => {
    expect(r.metadata).toMatchObject({
      title: 'How Tide Pools Work',
      description: 'A short field guide to the ecology of rocky tide pools.',
      siteName: 'Coastal Notes',
      byline: 'Ada Marsh',
      language: 'en',
      canonical: 'https://site.example/guides/tide-pools',
      publishedTime: '2026-03-14T09:00:00Z',
    });
    expect(r.source).toBe('local');
    expect(r.tokens).toBeGreaterThan(100);
  });

  it('writes lists, blockquotes and bold text as GitHub-flavoured Markdown', () => {
    expect(r.markdown).toContain('- **Splash zone**: lichens and periwinkles.');
    expect(r.markdown).toContain('> A tide pool is a laboratory that resets itself twice a day.');
  });
});

describe('convertHtml: documentation page', () => {
  const r = convertHtml(docs, { url: 'https://site.example/docs/start' });

  it('uses the <h1> as title when the <title> carries a site suffix', () => {
    expect(r.metadata.title).toBe('Getting started');
    expect(r.markdown.startsWith('# Getting started\n')).toBe(true);
  });

  it('keeps code block languages from data-lang, language-* and highlight-source-* classes', () => {
    expect(r.markdown).toContain('```bash\npip install widget-sdk\n```');
    expect(r.markdown).toContain('```python\nfrom widget import Client\n\nclient = Client(timeout=30)\nprint(client.ping())\n```');
    expect(r.markdown).toContain('```js\nconst client = new Client({ timeout: 30 });');
  });

  it('uses a longer fence when the code itself contains backticks', () => {
    expect(r.markdown).toContain('````\nHere is a fence inside code: ``` and more\n````');
  });

  it('converts tables to GFM tables with inline code', () => {
    expect(r.markdown).toMatch(/\| Option \| Type \| Default \|\n\| --- \| --- \| --- \|/);
    expect(r.markdown).toMatch(/\| `timeout` \| int \| 30 +\|/);
  });

  it('resolves relative links against the page URL and keeps in-page anchors as text', () => {
    expect(r.markdown).toContain('[API reference](https://site.example/docs/api#client)');
    expect(r.markdown).toContain('and the install section.');
  });
});

describe('options', () => {
  it('images: alt keeps only the alt text, strip removes images', () => {
    const alt = convertHtml(article, { url: 'https://s.example/', images: 'alt' }).markdown;
    expect(alt).not.toContain('![');
    expect(alt).toContain('A tide pool with anemones');
    const strip = convertHtml(article, { url: 'https://s.example/', images: 'strip' }).markdown;
    expect(strip).not.toContain('![');
    expect(strip).not.toContain('A tide pool with anemones');
  });

  it('links: footnote numbers each distinct URL, strip keeps the text', () => {
    const fn = convertHtml(article, { url: 'https://site.example/a', links: 'footnote' }).markdown;
    expect(fn).toContain('tide pools[^1]');
    expect(fn).toContain('[^1]: https://site.example/glossary/tide-pool');
    expect(fn).toContain('[^2]: https://example.org/field-guide?ref=notes');
    const strip = convertHtml(article, { url: 'https://site.example/a', links: 'strip' }).markdown;
    expect(strip).not.toMatch(/(^|[^!])\[[^\]]*\]\(https?:/m);
    expect(strip).toContain('leaves behind tide pools:');
  });

  it('contentMode full keeps the whole body minus page chrome', () => {
    const full = convertHtml(docs, { url: 'https://site.example/docs/start', contentMode: 'full' }).markdown;
    expect(full).toContain('This guide installs the SDK');
    expect(full).not.toContain('Docs home');
    expect(full).not.toContain('Docs footer');
  });

  it('title: false leaves the content as extracted', () => {
    const r = convertHtml('<html><head><title>T</title></head><body><p>Hello world</p></body></html>', { title: false, contentMode: 'full' });
    expect(r.markdown).toBe('Hello world\n');
  });

  it('frontmatter has quoted values where YAML needs them', () => {
    const r = convertHtml(article, { url: 'https://site.example/a', frontmatter: true, fetchedAt: FIXED_TIME });
    const fm = r.markdown.split('---\n')[1]!;
    expect(fm).toContain('title: How Tide Pools Work\n');
    expect(fm).toContain('url: "https://site.example/a"\n');
    expect(fm).toContain(`fetched_at: "${FIXED_TIME}"\n`);
    expect(fm).toContain('source: local\n');
    expect(r.markdown).toMatch(/^---\n[\s\S]+\n---\n\n# How Tide Pools Work/);
  });

  it('chunkTokens adds heading-aware chunks', () => {
    const r = convertHtml(article, { url: 'https://site.example/a', chunkTokens: 80 });
    expect(r.chunks!.length).toBeGreaterThan(2);
    expect(r.chunks!.every((c) => c.tokens <= 80)).toBe(true);
    expect(r.chunks!.some((c) => c.headings.includes('Zones of the shore'))).toBe(true);
  });
});

describe('helpers', () => {
  it('htmlToMarkdown converts fragments and numbered lists with nesting', () => {
    expect(htmlToMarkdown('<ol start="3"><li>three<ul><li>a</li></ul></li><li>four</li></ol>')).toBe('3. three\n   - a\n4. four\n');
  });

  it('escapes characters that would break link destinations', () => {
    expect(htmlToMarkdown('<a href="https://e.example/a (b)">x</a>')).toBe('[x](https://e.example/a%20%28b%29)\n');
  });

  it('tidyMarkdown collapses blank lines but not inside code fences', () => {
    expect(tidyMarkdown('a  \n\n\n\nb\n```\n\n\n\nc\n```\n')).toBe('a\n\nb\n```\n\n\n\nc\n```\n');
  });

  it('renderFrontmatter quotes values that YAML would misread', () => {
    expect(renderFrontmatter({ a: 'plain', b: 'has: colon', c: 'true', d: 12, e: undefined })).toBe('---\na: plain\nb: "has: colon"\nc: "true"\nd: 12\n---\n\n');
  });

  it('converts a page that readability cannot score through the full-body fallback', () => {
    const r = convertHtml('<html><body><nav>menu</nav><main><p>Short note.</p></main></body></html>', { title: false });
    expect(r.markdown).toBe('Short note.\n');
  });
});

describe('fragments', () => {
  it('converts an HTML fragment as-is, without readability', () => {
    expect(convertHtml('<h1>Hi</h1><p>there</p>').markdown).toBe('# Hi\n\nthere\n');
    expect(convertHtml('<p>Just one paragraph.</p>').markdown).toBe('Just one paragraph.\n');
  });
});

import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import type { ImagesMode, LinksMode } from './types';

export interface HtmlToMarkdownOptions {
  images?: ImagesMode;
  links?: LinksMode;
}

type TdNode = TurndownService.Node & { getAttribute(name: string): string | null; textContent: string | null; nodeName: string };

/** Percent-encodes the characters that would end a Markdown link destination. */
function escapeUrl(url: string): string {
  return url.replace(/[()\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function fenceFor(code: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  return '`'.repeat(longest + 1);
}

function build(opts: HtmlToMarkdownOptions, footnotes: string[]): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    hr: '---',
  });
  td.use(gfm);

  // Fenced code blocks keep their language (set as data-language during extraction).
  td.addRule('fencedCodeWithLanguage', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const el = node as TdNode;
      const code = (el.textContent ?? '').replace(/\n+$/, '');
      const lang = el.getAttribute('data-language') ?? '';
      const fence = fenceFor(code);
      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    },
  });

  const images = opts.images ?? 'inline';
  td.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as TdNode;
      const alt = (el.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
      const src = el.getAttribute('src') ?? '';
      if (images === 'strip' || !src || src.startsWith('data:')) return images === 'alt' && alt ? alt : '';
      if (images === 'alt') return alt;
      const title = el.getAttribute('title');
      return `![${alt.replace(/[[\]]/g, '\\$&')}](${escapeUrl(src)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
  });

  const links = opts.links ?? 'inline';
  td.addRule('links', {
    filter: (node) => node.nodeName === 'A' && !!(node as TdNode).getAttribute('href'),
    replacement: (content, node) => {
      const href = (node as TdNode).getAttribute('href') ?? '';
      const text = content.trim();
      if (!text) return '';
      if (links === 'strip' || /^javascript:/i.test(href) || href.startsWith('#')) return text;
      const url = escapeUrl(href);
      if (links === 'footnote') {
        let n = footnotes.indexOf(url) + 1;
        if (n === 0) n = footnotes.push(url);
        return `${text}[^${n}]`;
      }
      return `[${text}](${url})`;
    },
  });

  // List items with a single space after the marker ("- item", "1. item").
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const el = node as TdNode & { parentNode: TdNode | null; nextSibling: unknown };
      const parent = el.parentNode;
      let prefix = `${options.bulletListMarker ?? '-'} `;
      if (parent && parent.nodeName === 'OL') {
        const siblings = Array.from((parent as unknown as { children: ArrayLike<unknown> }).children);
        const start = Number(parent.getAttribute('start') ?? '1');
        prefix = `${(Number.isFinite(start) ? start : 1) + siblings.indexOf(el)}. `;
      }
      const indent = ' '.repeat(prefix.length);
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n(?!$)/gm, `\n${indent}`);
      return prefix + body + (el.nextSibling && !/\n$/.test(body) ? '\n' : '');
    },
  });

  td.remove(['script', 'style', 'noscript', 'template', 'iframe', 'form', 'button']);
  return td;
}

/** Tidies whitespace: no trailing spaces, at most one blank line in a row (outside code fences). */
export function tidyMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let blank = 0;
  for (const raw of lines) {
    const line = inFence ? raw : raw.replace(/[ \t]+$/, '');
    if (/^(`{3,}|~{3,})/.test(line.trim())) inFence = !inFence;
    if (!inFence && line.trim() === '') {
      blank++;
      if (blank > 1) continue;
    } else blank = 0;
    out.push(line);
  }
  return out.join('\n').trim() + '\n';
}

/** Converts an HTML fragment to GitHub-flavoured Markdown. */
export function htmlToMarkdown(html: string, opts: HtmlToMarkdownOptions = {}): string {
  const footnotes: string[] = [];
  let md = build(opts, footnotes).turndown(html);
  if (footnotes.length) md += '\n\n' + footnotes.map((u, i) => `[^${i + 1}]: ${u}`).join('\n');
  return tidyMarkdown(md);
}

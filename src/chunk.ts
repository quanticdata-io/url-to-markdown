import { estimateTokens } from './tokens';
import type { Chunk } from './types';

interface Block {
  text: string;
  /** Heading level when the block is a heading line. */
  level?: number;
  heading?: string;
}

/** Splits Markdown into blocks: headings, fenced code blocks and paragraphs. Fences are never split. */
function blocks(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.join('').trim()) out.push({ text: para.join('\n').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const code = [line];
      for (i++; i < lines.length; i++) {
        code.push(lines[i]!);
        if (lines[i]!.trim().startsWith(marker)) break;
      }
      out.push({ text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({ text: line.trim(), level: h[1]!.length, heading: h[2]! });
      continue;
    }
    if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  return out;
}

/** Splits one oversized block on line boundaries, then hard-splits single lines. */
function splitBlock(text: string, maxTokens: number): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  for (const line of text.split('\n')) {
    if (estimateTokens(line) > maxTokens) {
      if (cur.length) parts.push(cur.join('\n'));
      cur = [];
      const size = maxTokens * 4;
      for (let i = 0; i < line.length; i += size) parts.push(line.slice(i, i + size));
      continue;
    }
    if (cur.length && estimateTokens([...cur, line].join('\n')) > maxTokens) {
      parts.push(cur.join('\n'));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) parts.push(cur.join('\n'));
  return parts;
}

/**
 * Splits Markdown into chunks of at most `maxTokens` estimated tokens for RAG.
 * Chunks follow the heading structure: a new section starts a new chunk, each
 * chunk records its heading path, and code fences stay whole unless a single
 * fence alone exceeds the budget.
 */
export function chunkMarkdown(markdown: string, maxTokens = 512): Chunk[] {
  if (!Number.isFinite(maxTokens) || maxTokens < 16) throw new RangeError('maxTokens must be at least 16');
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const chunks: Chunk[] = [];
  const path: { level: number; text: string }[] = [];
  let current: string[] = [];
  let currentHeadings: string[] = [];

  const emit = () => {
    const content = current.join('\n\n').trim();
    if (content) chunks.push({ index: chunks.length, headings: currentHeadings, content, tokens: estimateTokens(content) });
    current = [];
  };

  for (const b of blocks(body)) {
    if (b.level !== undefined) {
      emit();
      while (path.length && path[path.length - 1]!.level >= b.level) path.pop();
      path.push({ level: b.level, text: b.heading ?? '' });
      currentHeadings = path.map((p) => p.text);
      current.push(b.text);
      continue;
    }
    const pieces = estimateTokens(b.text) > maxTokens ? splitBlock(b.text, maxTokens) : [b.text];
    for (const piece of pieces) {
      const next = [...current, piece].join('\n\n');
      if (current.length && estimateTokens(next) > maxTokens) {
        emit();
        currentHeadings = path.map((p) => p.text);
      }
      current.push(piece);
    }
  }
  emit();
  return chunks;
}

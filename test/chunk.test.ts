import { describe, expect, it } from 'vitest';
import { chunkMarkdown, estimateTokens } from '../src';

describe('estimateTokens', () => {
  it('is zero for empty text and grows with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('word '.repeat(100))).toBeGreaterThan(estimateTokens('word '.repeat(10)));
  });

  it('counts wide characters about one token each', () => {
    expect(estimateTokens('漢字漢字漢字漢字')).toBeGreaterThanOrEqual(8);
  });

  it('roughly matches four characters per token on prose', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
    const t = estimateTokens(text);
    expect(t).toBeGreaterThan(text.length / 5);
    expect(t).toBeLessThan(text.length / 2);
  });
});

describe('chunkMarkdown', () => {
  const doc = [
    '# Guide',
    'Intro paragraph.',
    '## Install',
    'Run the installer.',
    '```bash\nnpm install thing\n\nnpm test\n```',
    '## Use',
    '### Options',
    'Option text. '.repeat(60),
    '## End',
    'Bye.',
  ].join('\n\n');

  it('starts a chunk at each heading and records the heading path', () => {
    const chunks = chunkMarkdown(doc, 1000);
    expect(chunks.map((c) => c.headings)).toEqual([['Guide'], ['Guide', 'Install'], ['Guide', 'Use'], ['Guide', 'Use', 'Options'], ['Guide', 'End']]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps code fences whole, blank lines included', () => {
    const install = chunkMarkdown(doc, 1000)[1]!;
    expect(install.content).toContain('```bash\nnpm install thing\n\nnpm test\n```');
  });

  it('splits long sections under the budget', () => {
    const chunks = chunkMarkdown(doc, 40);
    expect(chunks.every((c) => c.tokens <= 40)).toBe(true);
    expect(chunks.filter((c) => c.headings.at(-1) === 'Options').length).toBeGreaterThan(1);
  });

  it('ignores YAML frontmatter', () => {
    const chunks = chunkMarkdown('---\ntitle: x\n---\n\n# A\n\ntext', 100);
    expect(chunks[0]!.content.startsWith('# A')).toBe(true);
  });

  it('rejects absurd budgets', () => {
    expect(() => chunkMarkdown('x', 2)).toThrow(RangeError);
  });
});

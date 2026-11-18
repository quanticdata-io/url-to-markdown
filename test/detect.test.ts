import { describe, expect, it } from 'vitest';
import { detectBlock, isJavaScriptShell } from '../src';
import { readFixture } from './helpers';

describe('detectBlock', () => {
  it('recognises an anti-bot interstitial even with HTTP 200', () => {
    expect(detectBlock(200, readFixture('challenge.html'))).toBe('challenge');
    expect(detectBlock(403, readFixture('challenge.html'))).toBe('challenge');
  });

  it('flags 403, 429 and 503 answers', () => {
    expect(detectBlock(403, '<html>Forbidden</html>')).toBe('http_403');
    expect(detectBlock(429, '')).toBe('http_429');
    expect(detectBlock(503, '')).toBe('http_503');
  });

  it('leaves real pages alone', () => {
    expect(detectBlock(200, readFixture('article.html'))).toBeUndefined();
    expect(detectBlock(404, '<html>Not found</html>')).toBeUndefined();
  });
});

describe('isJavaScriptShell', () => {
  it('detects an empty single-page-app shell', () => {
    expect(isJavaScriptShell(readFixture('js-shell.html'))).toBe(true);
  });

  it('does not flag server-rendered pages', () => {
    expect(isJavaScriptShell(readFixture('article.html'))).toBe(false);
    expect(isJavaScriptShell(readFixture('docs.html'))).toBe(false);
  });
});

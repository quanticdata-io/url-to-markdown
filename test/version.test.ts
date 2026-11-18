import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src';

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

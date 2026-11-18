import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const readFixture = (name: string): string => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');
export const TEST_KEY = 'qd_test_0123456789abcdef';
export const FIXED_TIME = '2026-01-01T00:00:00.000Z';

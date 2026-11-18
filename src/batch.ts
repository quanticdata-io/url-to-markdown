import { UrlToMarkdownError } from './errors';
import { fetchMarkdown } from './markdown';
import type { FetchMarkdownOptions, MarkdownResult } from './types';

export type BatchItem =
  | { ok: true; index: number; url: string; result: MarkdownResult }
  | { ok: false; index: number; url: string; error: UrlToMarkdownError };

export interface BatchOptions extends FetchMarkdownOptions {
  /** Pages fetched at the same time. Default 4. */
  concurrency?: number;
  /** Pause between starting two requests to the same host, in ms. Default 0. */
  delayMs?: number;
}

function asError(err: unknown, url: string): UrlToMarkdownError {
  if (err instanceof UrlToMarkdownError) return err;
  return new UrlToMarkdownError((err as Error)?.message ?? String(err), 'network', { url, cause: err });
}

/**
 * Converts many URLs with bounded concurrency. Yields one item per URL as soon
 * as it finishes (completion order; `index` is the input position). A failed
 * URL yields `ok: false` instead of stopping the batch.
 */
export async function* fetchMarkdownBatch(urls: Iterable<string>, opts: BatchOptions = {}): AsyncGenerator<BatchItem, void, undefined> {
  const list = [...urls];
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 64));
  const lastStart = new Map<string, number>();
  let next = 0;
  const running = new Map<number, Promise<BatchItem>>();

  const hostOf = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };

  const start = (index: number) => {
    const url = list[index]!;
    const p = (async (): Promise<BatchItem> => {
      if (opts.delayMs) {
        const host = hostOf(url);
        const prev = lastStart.get(host) ?? 0;
        const now = Date.now();
        const at = Math.max(now, prev + opts.delayMs);
        lastStart.set(host, at);
        if (at > now) await new Promise((r) => setTimeout(r, at - now));
      }
      try {
        return { ok: true, index, url, result: await fetchMarkdown(url, opts) };
      } catch (err) {
        return { ok: false, index, url, error: asError(err, url) };
      }
    })();
    running.set(index, p);
  };

  while (next < list.length && running.size < concurrency) start(next++);
  while (running.size) {
    const item = await Promise.race(running.values());
    running.delete(item.index);
    if (next < list.length) start(next++);
    yield item;
  }
}

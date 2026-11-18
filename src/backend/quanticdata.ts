/**
 * Optional backend: `POST /scraper/extract` of the QuanticData API, used for
 * pages the local fetcher cannot read (JavaScript-rendered or behind an
 * anti-bot challenge). Request fields and the response envelope follow the
 * public OpenAPI document at https://quanticdata.io/docs/openapi.json.
 */
import { UrlToMarkdownError } from '../errors';
import type { ContentMode, ImagesMode, LinksMode, QuanticDataOptions } from '../types';
import { VERSION } from '../version';

export const DEFAULT_API_BASE = 'https://api.quanticdata.io/v1';

export interface BackendRequest {
  url: string;
  contentMode?: ContentMode;
  images?: ImagesMode;
  links?: LinksMode;
}

export interface BackendResult {
  url: string;
  finalUrl: string;
  status: number;
  title?: string;
  description?: string;
  language?: string;
  canonical?: string;
  content: string;
  engine?: string;
}

interface ExtractPayload {
  url?: string;
  finalUrl?: string;
  status?: number;
  title?: string | null;
  content?: string;
  engine?: string;
  blockReason?: string;
  metadata?: { description?: string | null; canonical?: string | null; language?: string | null };
}

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** True when an API key is configured (option or `QUANTICDATA_API_KEY`). */
export function hasQuanticDataKey(opts: QuanticDataOptions = {}): boolean {
  return Boolean(opts.apiKey ?? env('QUANTICDATA_API_KEY'));
}

/** Fetches a page as Markdown through the QuanticData API. */
export async function quanticdataExtract(req: BackendRequest, opts: QuanticDataOptions = {}): Promise<BackendResult> {
  const apiKey = opts.apiKey ?? env('QUANTICDATA_API_KEY');
  if (!apiKey) {
    throw new UrlToMarkdownError(
      'The QuanticData backend needs an API key: set QUANTICDATA_API_KEY or pass quanticdata.apiKey. Keys are created on the API keys page of the QuanticData dashboard.',
      'config',
      { url: req.url },
    );
  }
  const base = (opts.baseUrl ?? env('QUANTICDATA_API_BASE') ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    url: req.url,
    format: 'markdown',
    // The API's `smart` mode is the closest match to the local `full` mode.
    contentMode: req.contentMode === 'full' ? 'smart' : 'article',
  };
  if (req.images) body.images_mode = req.images;
  if (req.links) body.links_mode = req.links;
  if (opts.render !== undefined) body.render = opts.render;
  if (opts.country) body.country = opts.country;
  if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
  if (opts.mobile !== undefined) body.mobile = opts.mobile;

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(`${base}/scraper/extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `url-to-markdown/${VERSION}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    const kind = controller.signal.aborted && !opts.signal?.aborted ? 'timeout' : 'backend';
    throw new UrlToMarkdownError(`QuanticData API request failed for ${req.url}: ${(err as Error).message}`, kind, { url: req.url, cause: err });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  let doc: { type?: string; message?: string; payload?: ExtractPayload } | undefined;
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    doc = undefined;
  }
  if (!res.ok || !doc || doc.type !== 'response' || !doc.payload) {
    const message = doc?.message ?? `HTTP ${res.status}`;
    throw new UrlToMarkdownError(`QuanticData API error for ${req.url}: ${message}`, 'backend', { url: req.url, status: res.status });
  }
  const p = doc.payload;
  if (p.blockReason) {
    throw new UrlToMarkdownError(`The page is still blocked through the QuanticData API (${p.blockReason}): ${req.url}`, 'blocked', {
      url: req.url,
      status: p.status,
    });
  }
  return {
    url: p.url ?? req.url,
    finalUrl: p.finalUrl ?? p.url ?? req.url,
    status: p.status ?? 200,
    title: p.title ?? undefined,
    description: p.metadata?.description ?? undefined,
    language: p.metadata?.language ?? undefined,
    canonical: p.metadata?.canonical ?? undefined,
    content: p.content ?? '',
    engine: p.engine,
  };
}

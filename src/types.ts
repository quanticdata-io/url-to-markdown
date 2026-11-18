/** How images are written: Markdown image, alt text only, or dropped. */
export type ImagesMode = 'inline' | 'alt' | 'strip';
/** How links are written: inline `[text](url)`, numbered footnotes, or text only. */
export type LinksMode = 'inline' | 'footnote' | 'strip';
/** `article`: main content only (readability). `full`: the whole body minus scripts, styles and page chrome. */
export type ContentMode = 'article' | 'full';
/** Where the page came from. */
export type Source = 'local' | 'quanticdata';

export interface ConvertOptions {
  /** URL of the page: used to resolve relative links and images, and written to the frontmatter. */
  url?: string;
  /** Default `article`. */
  contentMode?: ContentMode;
  /** Default `inline`. */
  images?: ImagesMode;
  /** Default `inline`. */
  links?: LinksMode;
  /** Prepend a YAML frontmatter block (title, url, description, ...). Default `false`. */
  frontmatter?: boolean;
  /** Start the document with `# Title` when the content does not already. Default `true`. */
  title?: boolean;
  /** Split the Markdown into chunks of at most this many (estimated) tokens. */
  chunkTokens?: number;
  /** Override the timestamp written as `fetched_at` (ISO 8601). */
  fetchedAt?: string;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  byline?: string;
  language?: string;
  canonical?: string;
  publishedTime?: string;
}

export interface Chunk {
  index: number;
  /** Heading path of the chunk, outermost first. */
  headings: string[];
  content: string;
  tokens: number;
}

export interface MarkdownResult {
  /** URL that was requested (or the `url` option for HTML input). */
  url?: string;
  /** URL after redirects. */
  finalUrl?: string;
  /** HTTP status of the final response, when the page was fetched. */
  status?: number;
  metadata: PageMetadata;
  /** The Markdown document (with frontmatter when requested). */
  markdown: string;
  /** Estimated token count of `markdown`. */
  tokens: number;
  source: Source;
  fetchedAt: string;
  chunks?: Chunk[];
}

export interface FetchOptions {
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Maximum redirects to follow. Default 10. */
  maxRedirects?: number;
  /** Retries of a request that failed before any response (connection refused or reset). Default 2. */
  retries?: number;
  /** Refuse bodies larger than this many bytes. Default 10 MiB. */
  maxBytes?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Override the User-Agent header. */
  userAgent?: string;
  /** Custom `fetch` (defaults to the global one). */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface QuanticDataOptions {
  /** API key; defaults to the `QUANTICDATA_API_KEY` environment variable. */
  apiKey?: string;
  /** API base; defaults to `QUANTICDATA_API_BASE` or `https://api.quanticdata.io/v1`. */
  baseUrl?: string;
  /** Force the headless browser tier (`render: true`). */
  render?: boolean;
  /** Exit country (`country`), e.g. `us`. */
  country?: string;
  /** Wait for this CSS selector before capture (render tier). */
  waitForSelector?: string;
  /** Mobile viewport and user agent. */
  mobile?: boolean;
  /** Request timeout in milliseconds. Default 120000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export type Backend = 'local' | 'quanticdata';

export interface FetchMarkdownOptions extends ConvertOptions, FetchOptions {
  /** `local` (default) fetches and converts on this machine; `quanticdata` uses the QuanticData API. */
  backend?: Backend;
  /**
   * With the local backend, retry through QuanticData when the page is blocked
   * (403/429/challenge) or is an empty JavaScript shell. Needs an API key.
   */
  unlock?: boolean;
  /** Options of the QuanticData backend. */
  quanticdata?: QuanticDataOptions;
}

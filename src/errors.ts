export type FetchErrorKind = 'http' | 'blocked' | 'timeout' | 'network' | 'too_large' | 'not_html' | 'redirects' | 'invalid_url';

/** A page could not be fetched or converted. `kind` says why. */
export class UrlToMarkdownError extends Error {
  readonly kind: FetchErrorKind | 'backend' | 'config';
  readonly url: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, kind: UrlToMarkdownError['kind'], opts: { url?: string; status?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'UrlToMarkdownError';
    this.kind = kind;
    this.url = opts.url;
    this.status = opts.status;
  }
}

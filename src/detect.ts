/**
 * Heuristics that tell a real page from an anti-bot interstitial or an empty
 * JavaScript application shell. They decide when `--unlock` hands a URL to the
 * QuanticData backend.
 */

const CHALLENGE_MARKERS: RegExp[] = [
  /<title>\s*just a moment/i,
  /<title>\s*attention required/i,
  /cf-chl-|challenge-platform|cf_chl_opt/i,
  /<title>\s*access denied\s*<\/title>/i,
  /captcha-delivery\.com|geo\.captcha|px-captcha|_pxCaptcha/i,
  /class=["'][^"']*(g-recaptcha|h-captcha|cf-turnstile)/i,
  /please (enable|turn on) (javascript|js) and (disable|turn off) any ad ?blocker/i,
  /verify(ing)? (that )?you are (a )?human/i,
  /unusual traffic from your (computer|network)/i,
];

export type BlockReason = 'http_403' | 'http_429' | 'http_503' | 'challenge';

/** Returns why the response looks blocked, or `undefined` when it looks like a real page. */
export function detectBlock(status: number, html: string): BlockReason | undefined {
  const head = html.slice(0, 200_000);
  const challenge = CHALLENGE_MARKERS.some((re) => re.test(head));
  if (challenge) return 'challenge';
  if (status === 403) return 'http_403';
  if (status === 429) return 'http_429';
  if (status === 503) return 'http_503';
  return undefined;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the HTML is an application shell whose content is rendered by
 * JavaScript: almost no visible text, but scripts or an empty mount node.
 */
export function isJavaScriptShell(html: string, minTextLength = 200): boolean {
  const text = visibleText(html);
  if (text.length >= minTextLength) return false;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const mountNode = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte|main-app)["'][^>]*>\s*<\/div>/i.test(html);
  const noscript = /<noscript[^>]*>[\s\S]*?(enable|turn on)\s+javascript[\s\S]*?<\/noscript>/i.test(html);
  return mountNode || noscript || scripts >= 1;
}

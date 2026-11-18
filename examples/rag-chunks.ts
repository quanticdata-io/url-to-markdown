/**
 * Build a small RAG corpus from a site's sitemap: one JSON line per chunk,
 * with the heading path as context.
 *
 *   npx tsx examples/rag-chunks.ts https://example.com 50 > corpus.jsonl
 *
 * Try it offline against the bundled test site:
 *   npm run demo-server &
 *   npx tsx examples/rag-chunks.ts http://127.0.0.1:8787 10
 */
import { discoverSitemapUrls, fetchMarkdownBatch } from '../src';

const [site = 'http://127.0.0.1:8787', limit = '20'] = process.argv.slice(2);

const urls = await discoverSitemapUrls(site, { limit: Number(limit) });
console.error(`${urls.length} page(s) in the sitemap`);

for await (const item of fetchMarkdownBatch(urls, { concurrency: 4, chunkTokens: 400, title: true })) {
  if (!item.ok) {
    console.error(`skip ${item.url}: ${item.error.kind} ${item.error.message}`);
    continue;
  }
  const { result } = item;
  for (const chunk of result.chunks ?? []) {
    process.stdout.write(
      JSON.stringify({
        id: `${result.finalUrl ?? item.url}#${chunk.index}`,
        url: result.finalUrl ?? item.url,
        title: result.metadata.title,
        section: chunk.headings.join(' > '),
        tokens: chunk.tokens,
        text: chunk.content,
      }) + '\n',
    );
  }
}

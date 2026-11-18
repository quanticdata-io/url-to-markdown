# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned:

- PDF to Markdown (local text layer, with the QuanticData backend for scanned files).
- Crawl mode that follows in-site links when a site has no sitemap.
- Per-host robots.txt checks in batch and sitemap mode.

## [0.1.0] - 2026-11-18

First release.

### Added

- `url-to-markdown` CLI: URLs, local files and stdin; `--input` URL lists; `--sitemap` discovery with limit and filters; Markdown, JSON and streamed JSONL output; output directory with one file per page; exit codes 0/1/2.
- Library API: `convertHtml`, `fetchMarkdown`, `fetchMarkdownBatch`, `discoverSitemapUrls`, `chunkMarkdown`, `estimateTokens` and the lower-level `extractContent`, `htmlToMarkdown`, `detectBlock`, `isJavaScriptShell`, `fetchPage`, `quanticdataExtract`.
- Main-content extraction with readability, cookie and consent banner removal, fallback to `<main>`/`<article>`/body; `full` mode for whole pages; HTML fragments converted as-is.
- GitHub-flavoured Markdown: tables, fenced code with language detection, nested lists, absolute links and images, lazy image sources, footnote links, image and link stripping.
- YAML frontmatter, token estimates and heading-aware chunks for RAG.
- Fetcher with timeout, size limit, manual redirects limited to http(s), charset detection and retries on failed connections.
- Block detection (challenge pages, 403/429/503) and JavaScript shell detection.
- Optional QuanticData backend (`--backend quanticdata`) and automatic fallback for blocked or JavaScript-only pages (`--unlock`).

[Unreleased]: https://github.com/quanticdata-io/url-to-markdown/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/quanticdata-io/url-to-markdown/releases/tag/v0.1.0

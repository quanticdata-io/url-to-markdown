# Contributing

Thanks for helping. Bug reports with a URL (or a saved HTML file) that converts badly are the most useful contribution: they become test fixtures.

## Setup

Node.js 18.17 or newer.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build && npm run check:package
```

`npm run demo-server` starts the local test site on http://127.0.0.1:8787 (with a stand-in for the QuanticData endpoint at `/v1`), so you can try the CLI without the internet.

## Rules for changes

- Tests never use the network or the paid API: add an HTML file to `test/fixtures/` and, when a request is involved, a route to `test/server.ts`.
- A conversion change comes with a test that shows the expected Markdown.
- Keep runtime dependencies few and well maintained; discuss new ones in an issue first.
- Public API changes need a CHANGELOG entry under `Unreleased`.
- Fields sent to the QuanticData API must exist in its OpenAPI document (https://quanticdata.io/docs/openapi.json).

## Pull requests

1. Fork and create a branch from `main`.
2. Make the change with tests; run the checks above.
3. Open the pull request and describe what changes for users.

By contributing you agree that your contribution is licensed under the MIT License.

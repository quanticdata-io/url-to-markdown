# Security policy

## Supported versions

Security fixes go into the latest minor release.

## Reporting a vulnerability

Please do not open a public issue. Email **hello@quanticdata.io** with "Security: url-to-markdown" in the subject, a description and steps to reproduce. You will get an acknowledgement within three working days and a fix or mitigation plan as soon as the issue is confirmed.

## Scope notes

- The tool fetches the URLs you give it. In server-side use, validate untrusted URLs yourself (for example, block private address ranges) before passing them in; the fetcher only enforces http(s) schemes, a size limit and a redirect limit.
- `QUANTICDATA_API_KEY` is sent only to the configured API base (`https://api.quanticdata.io/v1` by default) and only when the QuanticData backend is used.

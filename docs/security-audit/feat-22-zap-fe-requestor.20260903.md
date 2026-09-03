# Security Audit: feat/22-zap-fe-requestor — 2026-09-03

> Scope: `server/domain/nucleiTargets.ts`, `server/engines/zap/plan.ts`, `server/engines/zap/zapFe.ts` (the diff of PR #30 against `main`) | Stack: TypeScript / Nuxt 4 + Nitro, ZAP Automation Framework subprocess | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

## Executive Summary

This change makes the ZAP FE run send one GET per saved target (AF `requestor` job) so URLs the spider never reaches are scanned. The security question is whether a saved path can steer ZAP at a host the operator does not own (SSRF-style widening) or inject into the plan. Neither is possible: the URLs come from `expandNucleiTargets` — paths joined onto the site's own `frontBaseUrl`, which already passes the ownership gate at save time — and are then narrowed to that exact origin; nuclei has been requesting the same URLs since #2. The plan is emitted via `YAML.stringify` of a structured object, so a path cannot break out of its `url:` field. Semgrep reports no findings; manual review found **no true positives**.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

## Finding Summary

| ID  | Title                         | Severity | Location | Status |
| --- | ----------------------------- | -------- | -------- | ------ |
| —   | No true positives in the diff | —        | —        | —      |

## Manual Review

| Area                        | What was checked                                                                                                                                                                                                                                                                                | Result                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| SSRF / scope widening (2.4) | `zapFeRequestTargets` filters `expandNucleiTargets` output to `new URL(u).origin === frontOrigin`; `api:` lines (other origin) are dropped. `nucleiPaths` lines are schema-restricted to `/\S*` so a line cannot carry a scheme or host. The ownership gate (`nonLocalConfirmed`) is unchanged. | OK — no new host can be reached. |
| Injection (2.1) — plan file | `requestorJob` builds `{ url, method: 'GET' }` objects and the plan is serialised with `YAML.stringify`; no string templating of user paths into YAML. Method is fixed to GET (no body, no state-changing verbs regardless of opt-in).                                                          | OK.                              |
| Active-scan gating          | The requestor runs regardless of opt-in, but only GETs; `activeScan` presence and `seedEmptyQueryValues` are still keyed on `isActiveScanEnabled` (single source of truth). The transient `?q=1` seed never touches the saved list.                                                             | OK — matches the #13/#17 policy. |
| Data exposure (2.6)         | New log/meta field is a count (`targetUrlCount`); the URLs themselves were already logged for nuclei and appear in `reachedUrls`. No secrets involved (headers are still injected by the replacer file, not by the requestor).                                                                  | OK.                              |
| Excluded paths              | Same `parseExcludePatterns`/`pathMatchesAny` path as nuclei, so a path the operator excluded (logout, delete) is not requested. ZAP's own context `excludePaths` regex applies to the active scan on top.                                                                                       | OK.                              |
| Hash routes                 | `#` targets are dropped rather than requested as `/`: avoids duplicate root GETs and leaves DOM probing to #23.                                                                                                                                                                                 | OK.                              |

## Dependency Audit

No dependency changes in this PR. (`esbuild` dev-tooling advisories remain pre-existing on `main`; see the feat-13 report.)

## Remediation Priority

| Priority | Finding           | Action |
| -------- | ----------------- | ------ |
| —        | No P0/P1 findings | —      |

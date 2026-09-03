# Security Audit: feat/23-hash-route-dom-xss — 2026-09-03

> Scope: `server/engines/zap/domXssProbeScript.ts`, `server/engines/zap/plan.ts`, `server/engines/zap/zapFe.ts`, `server/domain/nucleiTargets.ts`, `server/engines/nuclei/index.ts`, `server/domain/markdownEngineMeta.ts` (the diff of PR #31 against `feat/22-zap-fe-requestor`) | Stack: TypeScript / Nuxt 4 + Nitro, ZAP Automation Framework + Selenium (Graal.js) subprocess | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

## Executive Summary

This change generates a ZAP standalone Graal.js script that drives a headless browser to inject XSS payloads into SPA hash routes. The script is offensive by design (it fires XSS at the target), so the audit focuses on: can it be pointed at a target the operator has not authorised, can a saved path break out of the generated script, and does it stay behind the active-scan opt-in. All three hold: the routes come from `zapFeHashRouteTargets`, which are paths joined onto the site's own `frontBaseUrl` (authorised at save time) and filtered to that origin; every route/payload/config value is embedded with `JSON.stringify`, so a route cannot escape the script source; and the probe is only wired in when `isActiveScanEnabled(site)` is true. Semgrep reports no findings; manual review found **no true positives**. Verified end to end on Juice Shop (HIGH raised with opt-in on, nothing with it off).

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

## Finding Summary

| ID  | Title                         | Severity | Location | Status |
| --- | ----------------------------- | -------- | -------- | ------ |
| —   | No true positives in the diff | —        | —        | —      |

## Manual Review

| Area                         | What was checked                                                                                                                                                                                                                                                                                                                   | Result                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Scope / authorisation (2.2)  | The probe runs only when `isActiveScanEnabled(site)` (opt-in ∧ ownership) — the same single gate nuclei DAST and the FE active scan read. `zapFeHashRouteTargets` filters to `new URL(u).origin === frontOrigin`; `api:` and cross-origin lines are dropped, so the probe can only hit the site's own front origin.                | OK — no unauthorised or off-origin target.              |
| Injection (2.1) — script gen | `buildDomXssProbeScript` embeds `routes`, `payloads`, `origin`, `canary`, budgets and paths via `JSON.stringify`; payload `__CANARY__`/`__TOKEN__` substitution happens in the browser. A route containing `</script>` stays inside a JS string literal (covered by a test). No user value is concatenated into the script source. | OK.                                                     |
| Injection — the payloads     | The payloads are the tool's own fixed strings (not user input) and are the intended attack content of an authorised active scan. They are URL-encoded into the target's empty query value in the browser.                                                                                                                          | OK by design (offensive tool, gated by opt-in).         |
| SSRF (2.4)                   | The browser navigates only to `origin` + the site's own hash-route URLs; there is no user-supplied absolute URL. Loopback is aliased through the existing `rewriteLoopbackHost`.                                                                                                                                                   | OK.                                                     |
| Reliability / DoS of self    | One browser (`getProxiedBrowser`, serial), a wall-clock budget (`budgetMs`, default 10 min) that records `truncated`, and `wd.quit()` in a `finally`. Mirrors the #17 lesson (DOM XSS rule's per-thread Firefox OOM). `timeoutMs` is extended by the probe budget so the engine timeout still bounds the run.                      | OK.                                                     |
| Alert pipeline               | Findings are raised as ZAP alerts (`Alert.builder()` + `ExtensionAlert.alertFound` with a `HistoryReference`), so report/normalize is unchanged; URLs are unaliased back to the real host by the existing path. Plugin id 40026 reuses ZAP's DOM XSS rule.                                                                         | OK — verified the HIGH lands in `report.json` findings. |
| Data exposure (2.6)          | The script carries no secrets (payloads/routes only), so it is written as an `extraFile` in the disposable per-scan work dir (like the discovery site-tree script). New meta fields are counts/booleans (`hashRouteCount`, `domXssProbed`, `domXssTruncated`).                                                                     | OK.                                                     |
| nuclei change                | `#` lines are dropped from nuclei's target file (`u.includes('#')`); a server-side scanner cannot test a fragment, so this removes noise, not coverage.                                                                                                                                                                            | OK.                                                     |

## Dependency Audit

No dependency changes in this PR. (`esbuild` dev-tooling advisories remain pre-existing on `main`; see the feat-13 report.)

## Remediation Priority

| Priority | Finding           | Action |
| -------- | ----------------- | ------ |
| —        | No P0/P1 findings | —      |

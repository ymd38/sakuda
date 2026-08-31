# Security Audit: feat/6-browser-storage-seeds — 2026-08-31

> Scope: `server/`, `shared/`, `app/components/site/`, `app/composables/` (the diff of PR #7 against `main`) | Stack: TypeScript / Nuxt 4 + Nitro, drizzle + better-sqlite3, ZAP (Selenium add-on) + nuclei subprocesses | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

---

## Executive Summary

This change stores a second class of per-site secret (browser storage: SPA login tokens, cookies) and hands it to a browser that ZAP drives. The sensitive paths were reviewed end to end: the values are sealed with the existing AES-256-GCM path (purpose-bound AAD, so a headers envelope and a storage envelope can never be swapped), returned by the API as kind + name only, written to disk exclusively as a 0600 file that is removed in `finally`, and passed into the page as `executeScript` arguments rather than spliced into JavaScript source. Semgrep reports no findings; manual review found **no true positives** in the diff.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives (Semgrep produced none)

---

## Pre-scan context

| Item                 | Value                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trust boundaries     | `POST/PUT /api/sites` JSON (`browserStorage[]`, `discoverySeedPaths`), stored site config read by the job runners, the generated Selenium script executed inside ZAP's Firefox |
| Authentication model | None — single-operator local tool bound to `127.0.0.1` (pre-existing, SPEC §7)                                                                                                 |
| Data sensitivity     | Login tokens / cookies for the operator's own target (equivalent to the existing auth headers)                                                                                 |
| Deployment           | Local Docker, one container; non-local targets gated by `nonLocalConfirmed` (unchanged)                                                                                        |

---

## Finding Summary

| ID  | Title                | Severity | Location | Status |
| --- | -------------------- | -------- | -------- | ------ |
| —   | No findings in scope | —        | —        | —      |

---

## Manual review — areas checked, no finding

| Area                      | What was checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Result |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Secrets at rest (2.3)     | `createSecretCipher` reuses the same AES-256-GCM primitive, 12-byte random nonce, 16-byte tag and version byte as headers; `purpose: 'browserStorage'` is folded into the AAD so a headers envelope cannot be opened as storage or vice versa (`headerCipher.spec`). Empty lists are stored as `NULL`, never as an envelope. Headers keep their original AAD — no re-encryption needed, verified by the untouched round-trip tests.                                                                            | OK     |
| Secrets in the API (2.6)  | `toSitePublic` strips `browserStorageEnc`; only `browserStorageNames` (kind + name) is returned. `PUT` omitting `browserStorage` keeps the stored set; `[]` clears it. e2e asserts the value never appears in any response.                                                                                                                                                                                                                                                                                    | OK     |
| Secrets in logs (2.6)     | Discovery / zap-fe log `browserStorageNames` only; the pino logger additionally redacts any `value` / `*.value` field. The ZAP-side script prints a count and the browser id, never a value. `meta.browserStorage` stores `kind:name` strings.                                                                                                                                                                                                                                                                 | OK     |
| Secrets on disk (2.3)     | `runZap.secretFiles` writes `browser-storage.js` with mode `0o600` inside the try and `rm`s it in `finally` (tested for the success path and for a spawn failure). ZAP's per-run `zaphome` (where the add-on records the script path) is removed in the same `finally`. Verified in the running container: `-rw------- browser-storage.js` during the run, absent afterwards.                                                                                                                                  | OK     |
| Script injection (2.1)    | `buildBrowserStorageScript` embeds `items` and `origins` via `JSON.stringify` (a JS-safe literal) and passes every name/value to `executeScript(...)` as **arguments**, so a value containing quotes, newlines or `</script>` cannot alter the script (`browserStorageScript.spec` asserts the raw value is absent from the source). Cookie names are validated as tokens and cookie values may not contain `;` (`BrowserStorageItemSchema`), so `document.cookie = name=value; path=/` cannot set attributes. | OK     |
| Where the values go (2.4) | The script only navigates to `ORIGINS` = the site's own `frontBaseUrl` / `apiBaseUrl` (already gated by `nonLocalConfirmed`) and sets storage there; web storage is origin-bound, so the token cannot be planted on another origin. The Ajax spider scope (`includePaths`) is unchanged.                                                                                                                                                                                                                       | OK     |
| Input validation (2.1)    | `discoverySeedPaths` lines must match `^\/\S*$` (no absolute URLs, so a seed cannot point the spider off-origin); at most 20 storage items, names ≤ 200 and values ≤ 10 000 chars, no CR/LF.                                                                                                                                                                                                                                                                                                                   | OK     |
| Path handling (2.2)       | Script and dump file names are compile-time constants; the work dir is `join(discoveriesDir, <server UUID>)` as before.                                                                                                                                                                                                                                                                                                                                                                                        | OK     |
| XSS (2.5)                 | New Vue markup renders `kind:name` chips and seeds via text interpolation only; values are `<input type="password">` and never re-rendered.                                                                                                                                                                                                                                                                                                                                                                    | OK     |

---

## False Positives

None — Semgrep (`p/typescript`, `p/javascript`, `p/owasp-top-ten`, `p/nodejs`) reported 0 findings on the scope.

---

## Dependency Audit

`pnpm audit --prod --audit-level=high` (2026-08-31): passes — 1 Low advisory (`esbuild` <0.28.1, arbitrary file read by its dev server on Windows; transitive, not part of the runtime image). Pre-existing on `main`, unrelated to this change — out of scope.

---

## Remediation Priority

| Priority | Finding | Action |
| -------- | ------- | ------ |
| —        | none    | —      |

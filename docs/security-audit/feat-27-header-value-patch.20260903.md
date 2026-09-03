# Security Audit: feat/27-header-value-patch — 2026-09-03

> Scope: `shared/schemas/{headers,site}.ts`, `server/api/sites/[id].put.ts`, `server/services/siteService.ts`, `app/components/site/SiteForm.vue`, `app/pages/sites/` (the diff of PR #29 against `main`) | Stack: TypeScript / Nuxt 4 + Nitro, drizzle + better-sqlite3, AES-256-GCM per-site secrets | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

## Executive Summary

This change lets `PUT /api/sites/:id` accept header rows without a `value`, which the service resolves against the stored (encrypted) header set before re-sealing. The security questions are whether the write-only contract survives (values must never leave the server), whether the merge can be steered to read or copy a value the caller did not already own, and whether the looser row shape opens an injection path. All three were reviewed: the only new output that mentions headers is a 422 listing header _names_ (already public via `headerNames`); the merge only ever reads the caller's own site row, addressed by the route id that was already the write target; and the `value` that reaches the envelope is still `HeaderValue` (CR/LF rejected) or a value the same site already stored. Semgrep (`p/typescript`, `p/owasp-top-ten`, `p/secrets`) reports no findings; manual review found **no true positives**.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

## Finding Summary

| ID  | Title                         | Severity | Location | Status |
| --- | ----------------------------- | -------- | -------- | ------ |
| —   | No true positives in the diff | —        | —        | —      |

## Manual Review

| Area                                     | What was checked                                                                                                                                                                                                                                                                                                                                      | Result                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Data exposure (2.6) — write-only headers | `mergeHeaderPatches` opens the envelope inside the service and the merged list goes straight back into `sealHeaders`; `updateSite` still returns `toSitePublic` (names only). The new 422 message and `details.headers` carry names, never values (`siteService.spec.ts` asserts the stored value is absent from the message). Nothing new is logged. | OK — no value reaches a response, a log, or the DOM.                                        |
| Broken access control (2.2)              | sakuda has no per-user auth by design (single-operator local tool, README "Keep it local"). The merge reads `existing.headersEnc` for the same `id` the route already updates, so it cannot be pointed at another site's envelope; AAD binding to the site id in `headerCipher` also makes a swapped blob fail to open.                               | OK — unchanged trust model, no cross-site read introduced.                                  |
| Injection (2.1)                          | Header values are still `HeaderValue` (`/^[^\r\n]*$/`, so no header-splitting) or a previously validated stored value; names still `/^[^\s:]+$/`. DB writes go through drizzle `.set()` (parameterized). No engine argv or shell path is touched.                                                                                                     | OK.                                                                                         |
| Input validation (boundary)              | `SiteUpdateSchema` is `SiteFieldsSchema.extend({ headers: HeaderPatchesSchema })` with the same `refineSiteFields` as create (`siteSchema.spec.ts` checks the cross-field rules apply). Duplicate names are rejected at the schema so the merge is never ambiguous; `POST` keeps `HeadersSchema` (value required).                                    | OK.                                                                                         |
| Partial failure / atomicity              | The 422 for an unknown value-less name is thrown before the `UPDATE`, so a bad row leaves the site untouched (test: name and headers unchanged after the rejected call).                                                                                                                                                                              | OK.                                                                                         |
| Frontend (2.5)                           | Value inputs remain `type="password" autocomplete="off"` and are never prefilled (the API has nothing to prefill them with). Rows render stored names via `v-model` on inputs, not as raw HTML. No `v-html`, no DOM sinks.                                                                                                                            | OK.                                                                                         |
| Secrets (2.3)                            | Semgrep `p/secrets`: none. Test fixtures use placeholder values (`Bearer old`, `token=new`).                                                                                                                                                                                                                                                          | OK.                                                                                         |
| Residual / design note                   | A caller who can reach the API can already replace every header; this change additionally lets them keep values they cannot read. That is the intended contract (write-only, mergeable) and adds no capability beyond what `PUT` with full values already granted.                                                                                    | Noted, no action — see README's warning about exposing the port beyond the operator's host. |

## Dependency Audit

No dependency changes in this PR. (`pnpm audit`: the two `esbuild` dev-tooling advisories — via `drizzle-kit` and `@nuxt/eslint`'s config inspector — remain pre-existing on `main`; see the feat-13 report.)

## Remediation Priority

| Priority | Finding           | Action |
| -------- | ----------------- | ------ |
| —        | No P0/P1 findings | —      |

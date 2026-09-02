# Security Audit: feat/13-active-injection-scan — 2026-09-02

> Scope: `server/domain/activeScan.ts`, `server/engines/nuclei/`, `server/config/env.ts`, `server/db/schema.ts`, `shared/schemas/site.ts`, `app/components/site/SiteForm.vue`, `server/domain/markdownEngineMeta.ts` (the diff of PR #19 against `main`) | Stack: TypeScript / Nuxt 4 + Nitro, drizzle + better-sqlite3, nuclei subprocess | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

---

## Executive Summary

This change adds a per-site opt-in (`allowMutatingRequests`, default off) that makes nuclei send attack payloads (DAST/fuzzing templates) at the target. The security-relevant questions are therefore (1) can the opt-in be reached without the existing ownership guard, (2) can any user-influenced value reach the nuclei command line, and (3) does the new state leak anything. All three were reviewed end to end: the effective decision is a pure conjunction of the opt-in and the ownership guard (`isActiveScanEnabled`), the only new argv values are operator-controlled env paths passed through `spawn`'s argument array (no shell), and the new log/meta fields are a boolean, a count and an env path. Semgrep reports no findings; manual review found **no true positives** in the diff.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded | 1 informational observation (pre-existing behaviour, not introduced here)

---

## Finding Summary

| ID     | Title                                                           | Severity      | Location                                                                        | Status      |
| ------ | --------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------- | ----------- |
| —      | No true positives in the diff                                   | —             | —                                                                               | —           |
| OBS-01 | OAST (interactsh) templates phone home to public `oast.*` hosts | Informational | `server/engines/nuclei/args.ts` (pre-existing, `-tags ssrf` already loads them) | Observation |

---

## Manual Review

| Area                                          | What was checked                                                                                                                                                                                                                                                                                                                                                                                                               | Result                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Broken access control (2.2) — ownership guard | `isActiveScanEnabled` (`server/domain/activeScan.ts:22`) returns `false` unless `allowMutatingRequests && (!requiresConfirmation \|\| nonLocalConfirmed)`. `SiteInputSchema` still refuses an unconfirmed non-local site at write time (`shared/schemas/site.ts:88`), so the second term is defence in depth for a stale row. Covered by `activeScan.spec.ts` and `nuclei/index.spec.ts` ("stays passive when … unconfirmed"). | OK — the opt-in cannot widen scope past the existing guard. |
| Injection (2.1) — command line                | `dastTemplatesDir` (`args.ts:30,37`) comes from `env.nuclei.dastTemplatesDir`, i.e. `SAKUDA_NUCLEI_DAST_TEMPLATES` (operator env), never from a request. `runCommand` spawns with an argv array, no shell. Target URLs continue to reach nuclei only through the `-l` file, unchanged.                                                                                                                                         | OK.                                                         |
| Input validation (boundary)                   | New field is `z.boolean().default(false)` on the one site schema; the API handlers and `siteService` spread the parsed object, so no ad-hoc parsing was added. DB column is `NOT NULL DEFAULT false` — existing rows stay off after migration.                                                                                                                                                                                 | OK.                                                         |
| Secrets & logging (2.3, 2.6)                  | New structured-log fields: `activeScan` (boolean), `parameterizedUrlCount` (number). New meta fields: the same plus `dastTemplatesDir` (env path — same class of disclosure as the existing `templatesDir` meta, on a single-user localhost-bound UI). Warning text is static. `-omit-raw` is still passed, so DAST request/response bodies (which would carry the injected auth headers) are never written to disk.           | OK.                                                         |
| Frontend (2.5)                                | The new checkbox/label/help text in `SiteForm.vue` is static template text bound with `v-model`; no `v-html`, no user-controlled rendering.                                                                                                                                                                                                                                                                                    | OK.                                                         |
| Blast radius of the new capability            | DAST templates are gated per site, default off, and `-exclude-tags dos,fuzz,intrusive` is unchanged — the two `cmdi` templates tagged `fuzz` (OS command execution) stay excluded; #18 tracks making that a deliberate per-site choice.                                                                                                                                                                                        | OK by design (Issue #13 done criteria).                     |

### OBS-01 — OAST templates phone home (pre-existing)

**Severity**: Informational | **Location**: `server/engines/nuclei/args.ts` | **Confidence**: High

The DAST tree adds 14 `ssti … oast` templates and `blind-ssrf`, which use nuclei's interactsh client and therefore contact public `oast.*` hosts, embedding target-derived data in the callback names. This is **not new**: the signature run already loads `-tags ssrf` OAST templates from `http/`, and nuclei is run without `-no-interactsh`. For a tool that scans self-owned dev environments the disclosure is limited to hostnames/paths of a non-public target, so it is recorded as an observation rather than a finding. If that ever matters, the smallest fix is a `-ni` flag (or a self-hosted interactsh server) — outside this PR's scope.

---

## False Positives

None — Semgrep (`--config auto`, 1.151.0) returned 0 results on the scoped paths.

---

## Dependency Audit

`pnpm audit` (no dependency changes in this PR — both findings pre-exist on `main`):

| Package   | Advisory                                            | Severity | Installed                               | Fixed In |
| --------- | --------------------------------------------------- | -------- | --------------------------------------- | -------- |
| `esbuild` | GHSA-67mh-4wv8-2f99 (dev server accepts any origin) | Moderate | <=0.24.2 (transitive, dev only)         | >=0.25.0 |
| `esbuild` | arbitrary file read in dev server                   | Low      | >=0.27.3 <0.28.1 (transitive, dev only) | >=0.28.1 |

Both are dev-server-only advisories in a transitive build dependency; the production image runs `.output/server` without esbuild. **Action**: none in this PR; bump via the next toolchain update.

---

## Remediation Priority

| Priority | Finding            | Action                                                                                               |
| -------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| —        | No P0/P1 findings  | —                                                                                                    |
| Backlog  | OBS-01             | Consider `-ni` / self-hosted interactsh if targets ever become sensitive (separate issue if pursued) |
| Backlog  | esbuild advisories | Bump transitive esbuild with the next Nuxt/Vite update                                               |

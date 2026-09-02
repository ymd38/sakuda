# Security Audit: feat/18-nuclei-risk-tags — 2026-09-02

> Scope: `server/domain/activeScan.ts`, `server/engines/nuclei/{args,index}.ts`, `shared/schemas/site.ts`, `shared/types/api.ts`, `server/db/schema.ts`, `app/components/site/SiteForm.vue`, `server/domain/markdownEngineMeta.ts` (the diff of PR #20 against `feat/13-active-injection-scan`) | Stack: TypeScript / Nuxt 4 + Nitro, drizzle + better-sqlite3, nuclei subprocess | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified.

## Executive Summary

This change lets a site opt individual nuclei risk-template groups (`dos`/`fuzz`/`intrusive`) back in, which can send more damaging payloads (RCE fuzzing, DoS). The security question is whether the toggle can widen a scan's reach without the ownership + opt-in gate, or inject into the nuclei command line. Both were reviewed: the effective set is `effectiveRiskTags`, which returns `[]` unless `isActiveScanEnabled` (opt-in ∧ ownership) holds, so a stale `nucleiEnabledRiskTags` cannot re-open the groups on its own; and the values that reach `-tags`/`-exclude-tags` come from a fixed `z.enum(RISK_TAGS)`, never free text. Semgrep reports no findings; manual review found **no true positives**.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

## Finding Summary

| ID  | Title                         | Severity | Location | Status |
| --- | ----------------------------- | -------- | -------- | ------ |
| —   | No true positives in the diff | —        | —        | —      |

## Manual Review

| Area                           | What was checked                                                                                                                                                                                                                                                                                                | Result                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Broken access control (2.2)    | `effectiveRiskTags` (`server/domain/activeScan.ts`) short-circuits to `[]` when `isActiveScanEnabled` is false, i.e. without opt-in AND (local or confirmed). The dangerous `dos`/`fuzz` groups therefore require opt-in ∧ ownership ∧ explicit per-group selection.                                            | OK — no path enables a risk group without all three. |
| Injection (2.1) — command line | The tags added to `-tags` (`riskExtraTags`) come from a static `Record<RiskTag,…>` keyed by the enum; `-exclude-tags` from `riskExcludeTags` filters the same fixed list. No request-derived string reaches the argv. `runCommand` uses an argv array (no shell).                                               | OK.                                                  |
| Input validation (boundary)    | `nucleiEnabledRiskTags: z.array(z.enum(RISK_TAGS)).default([])` — unknown values are rejected at the schema boundary (`siteSchema.spec.ts`). DB column is `NOT NULL DEFAULT '[]'`.                                                                                                                              | OK.                                                  |
| Frontend (2.5)                 | New checkboxes are static template bound with `v-model`; `:disabled` gates on `allowMutatingRequests`. No user-controlled rendering.                                                                                                                                                                            | OK.                                                  |
| Blast radius                   | Enabling `fuzz` adds `rce` to `-tags`, pulling in ~150 signature RCE templates in addition to the DAST command-injection fuzzers — a broad but intentional expansion, gated behind the opt-in and a labelled UI toggle. `dos` can crash the target; UI marks it the most dangerous and it stays off by default. | OK by design; noted for the reviewer in the PR.      |

## Dependency Audit

No dependency changes in this PR. (`esbuild` dev-server advisories remain pre-existing on `main`; see the feat-13 report.)

## Remediation Priority

| Priority | Finding           | Action |
| -------- | ----------------- | ------ |
| —        | No P0/P1 findings | —      |

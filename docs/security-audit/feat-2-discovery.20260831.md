# Security Audit: feat/2-discovery-targets — 2026-08-31

> Scope: `server/`, `shared/`, `app/components/site/DiscoveryPanel.vue`, `app/composables/` (the diff of PR #3 against `main`) | Stack: TypeScript / Nuxt 4 + Nitro (h3), drizzle + better-sqlite3, ZAP + nuclei subprocesses | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified by the audit itself. One regression (V-01) was fixed afterwards by `yds-gh-issue-resolver` step 8.4, inside the agreed plan's impact scope.

---

## Executive Summary

The discovery feature adds four unauthenticated-by-design API routes (sakuda is a single-operator tool bound to `127.0.0.1`, see SPEC §7), a ZAP crawl driven by site configuration, and a file-system work dir per job. All new input is validated at the boundary with zod, every DB access goes through drizzle's parameterized builder, and every file path is composed from a server-generated UUID rather than request data. Semgrep (registry rulesets `p/typescript`, `p/javascript`, `p/owasp-top-ten`, `p/nodejs`) reports no findings on the scope. Manual review found one **Low** availability/integrity gap introduced by this change (V-01) and no exploitable injection, traversal, SSRF-widening, or XSS.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 1 true positive (Low, fixed) | 0 false positives discarded (Semgrep produced none)

---

## Pre-scan context

| Item                 | Value                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trust boundaries     | HTTP JSON bodies (`POST /api/sites/:id/targets`), route params (site / discovery ids), site configuration already stored in the DB (base URLs, seed path, headers), ZAP's site-tree dump file written by the ZAP process |
| Authentication model | None — single-operator local tool; `SAKUDA_BIND` defaults to `127.0.0.1` (pre-existing design, SPEC §7.5)                                                                                                                |
| Data sensitivity     | Site headers (bearer tokens / cookies) are AES-GCM sealed at rest and never logged; discovered URLs may carry query strings                                                                                              |
| Deployment           | Local Docker, one container; targets are the operator's own apps (non-local hosts require `nonLocalConfirmed`)                                                                                                           |

---

## Finding Summary

| ID   | Title                                                                                   | Severity | Location                                            | Status                    |
| ---- | --------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ------------------------- |
| V-01 | `addSiteTargets` can grow `nucleiPaths` past the form schema limit, bricking site edits | Low      | `server/services/siteService.ts` (`addSiteTargets`) | True Positive — **fixed** |

---

## Findings

### V-01 — `addSiteTargets` can grow `nucleiPaths` past the form schema limit

**Severity**: Low | **Location**: `server/services/siteService.ts` (`addSiteTargets`, before the fix) | **Confidence**: High

#### Vulnerable Code

```ts
// server/services/siteService.ts (before)
const merged = mergeTargetLines(existing.nucleiPaths, lines)
// ... invalid-line and api: checks ...
if (merged.added.length > 0)
  deps.db.update(sites).set({ nucleiPaths: merged.text, ... })
```

`SiteInputSchema` caps `nucleiPaths` at 20 000 characters, but this new write path bypassed the schema. `AddTargetsBodySchema` allows 1 000 lines × 2 000 chars per request, and the request is append-only and repeatable.

#### Attack Path

1. A discovery of ~500 URLs (the cap) with average 60-char paths is saved from the panel — ≈30 000 characters, or an operator posts a few large `POST /api/sites/:id/targets` bodies.
2. `nucleiPaths` now exceeds 20 000 characters.
3. Every subsequent `PUT /api/sites/:id` from the Edit form fails validation (422 on `nucleiPaths`), so the operator can no longer change _any_ site field (headers, limits) until they trim the list by hand through the API.
4. **Impact**: self-inflicted loss of configurability (integrity/availability of the site record); no confidentiality impact, no cross-user impact (single operator).

#### Risk Assessment

- **Severity**: Low (requires operator action, local tool, no data exposure)
- **CVSS v3.1 estimate**: AV:L/AC:L/PR:L/UI:R/S:U/C:N/I:L/A:L (~3.5)
- **Impact Area**: API → site configuration
- **Confidence**: High — reproduced in a unit test (`siteService.spec.ts`, "rejects a save that would push nucleiPaths over the site schema limit")

#### Recommended Fix (applied)

Enforce the same limit at the new write path, from one shared constant:

```ts
// shared/schemas/site.ts
export const NUCLEI_PATHS_MAX_CHARS = 20_000
// server/services/siteService.ts
if (merged.text.length > NUCLEI_PATHS_MAX_CHARS)
  throw new ServiceError(
    422,
    'VALIDATION',
    `... over the ${NUCLEI_PATHS_MAX_CHARS} limit — select fewer URLs ...`,
  )
```

---

## Manual review — areas checked, no finding

| Area                         | What was checked                                                                                                                                                                                                                                                                                                                                                     | Result                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Injection (2.1)              | All DB access in `discoveryService`, `activeJobs`, `siteService.addSiteTargets` uses drizzle query builders (bound parameters). ZAP/nuclei are spawned via `runCommand` (`spawn`, no shell). The Graal.js dump script embeds only `outputPath`, built from `env.discoveriesDir` + a server-generated UUID and inserted with `JSON.stringify` (`siteTreeDump.ts:35`). | No user-controlled data reaches a query, shell, or script. |
| Access control / IDOR (2.2)  | New routes take a site / discovery id. There is no per-user ownership in sakuda (single operator, pre-existing). `createDiscovery` re-applies the `nonLocalConfirmed` gate that `createScan` uses, so discovery cannot crawl a host a scan could not.                                                                                                                | Consistent with existing model; no widening.               |
| Path traversal (2.2)         | `workDir = join(env.discoveriesDir, discoveryId)` where `discoveryId` comes from the claimed DB row (UUID), never from the request. `extraFiles` keys are compile-time constants. Deletion removes `join(discoveriesDir, row.id)` for rows of the deleted site only.                                                                                                 | No traversal surface.                                      |
| Secrets & logging (2.3, 2.6) | Headers reach ZAP only via `replacer.conf` (0600, removed in `finally`, unchanged). Discovery logs emit counts, `seedUrl`, and header _names_ only (`zapDiscover.ts:56,109`); discovered URLs are stored in the DB/UI, never logged.                                                                                                                                 | OK.                                                        |
| SSRF (2.4)                   | The crawl target is the stored `frontBaseUrl`/`apiBaseUrl` (already gated). Discovery adds the API origin to ZAP's `includePaths`, which narrows rather than widens scope. Discovered URLs are filtered to those origins (`crawledUrls.ts`) before storage and are never fetched by sakuda itself.                                                                   | No new outbound surface.                                   |
| XSS (2.5)                    | `DiscoveryPanel.vue` renders discovered URLs and warnings through `{{ }}` text interpolation only; no `v-html`.                                                                                                                                                                                                                                                      | OK.                                                        |
| Input validation (2.1/2.6)   | `AddTargetsBodySchema` (array 1–1000, string ≤2000), then `mergeTargetLines` rejects any line not matching `^(api:)?\/\S*$` and reports all invalid lines at once; `api:` lines require `apiBaseUrl`. The ZAP dump is parsed with a zod schema per line; malformed lines are counted, not thrown.                                                                    | OK (plus V-01 fix).                                        |
| Concurrency                  | One active job per site (`activeJobs.ts`), single sequential worker; `claimNextQueuedDiscovery` flips status inside a transaction with a status guard.                                                                                                                                                                                                               | No double-run.                                             |

---

## False Positives

None — Semgrep reported 0 findings on the scope.

---

## Dependency Audit

`pnpm audit` (2026-08-31):

| Package   | Advisory                             | Severity | Installed                         | Fixed In |
| --------- | ------------------------------------ | -------- | --------------------------------- | -------- |
| `esbuild` | GHSA (dev-server request forwarding) | Moderate | ≤0.24.2 (transitive, dev)         | ≥0.25.0  |
| `esbuild` | GHSA                                 | Low      | ≥0.27.3 <0.28.1 (transitive, dev) | ≥0.28.1  |

Both are development-time transitive dependencies (build tooling), pre-existing on `main`, and not shipped in the runtime image. **Out of scope for this PR** — candidates for `yds-report-to-issues`.

---

## Remediation Priority

| Priority                 | Finding            | Action                                                                                    |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------- |
| **P1 — Fix this sprint** | V-01               | Done in this PR: shared `NUCLEI_PATHS_MAX_CHARS`, enforced in `addSiteTargets` with a 422 |
| Backlog                  | esbuild advisories | Bump transitive `esbuild` via the Nuxt/Vite toolchain when the next upgrade lands         |

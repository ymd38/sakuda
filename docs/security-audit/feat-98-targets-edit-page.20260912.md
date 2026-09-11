# Security Audit: feat/98-targets-edit-page — 2026-09-12

> Scope: `server/api/sites/[id]/targets.delete.ts`, `server/services/siteService.ts`, `shared/utils/targetLines.ts`, `shared/schemas/targets.ts`, `app/components/site/DiscoveryPanel.vue`, `app/pages/sites/[id]/edit.vue`, `app/components/site/SiteForm.vue` (the target-removal change, #98) | Stack: TypeScript / Nuxt (Nitro) / Node 22 | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified. Baseline: `main` (77fcf4b). Trigger: new request-body endpoint (input handling) in the diff.

---

## Executive Summary

The change adds one mutating endpoint, `DELETE /api/sites/:id/targets`, that removes a single saved target line, and moves the discovery review panel from the Site page to the Edit page. The new input (`line`) is bounded by zod at the boundary, parsed by the same line grammar every other consumer uses, and only ever reaches a Drizzle parameterized `UPDATE` — never a shell, the filesystem or an outbound request. Semgrep reports nothing in scope; no new finding was introduced. The endpoint inherits the API's existing no-authentication posture (single-user local tool), which is pre-existing and out of scope here.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

---

## Finding Summary

| ID  | Title | Severity | Location | Status |
| --- | ----- | -------- | -------- | ------ |
| —   | none  | —        | —        | —      |

---

## Manual Review Notes

- **Trust boundary**: `RemoveTargetBodySchema` (`shared/schemas/targets.ts`) accepts one string, 1–2 000 chars; `parseBody` rejects anything else before the service runs. `removeTargetLine` then parses it with `parseNucleiPathLines` — a line that is not `[METHOD] [api:]/path` is a 422 with nothing written.
- **Injection**: the line is compared by `targetLineKey` (string equality) against the parsed saved list and the surviving text is written through Drizzle's `.set({...})` — a bound parameter, no string-built SQL. No `exec`/`spawn`, no `fs`, no `fetch` on this path.
- **ReDoS**: the grammar regex `^(?:(\S+)\s+)?(api:)?(\/\S*)$` alternates disjoint classes (`\S` / `\s`), so backtracking is linear; the saved text it iterates is capped by `NUCLEI_PATHS_MAX_CHARS`.
- **Idempotency / partial failure**: a non-matching line performs no write and returns `removed: false` (tested), so a retried DELETE is safe. The line's `requestShapes` entry is pruned in the same `UPDATE` (`pruneRequestShapes`, now shared with `updateSite`), so a shape cannot outlive its line.
- **Reflected input**: the 422 message echoes the offending line, as `addSiteTargets` already does. The panel renders it through Vue text interpolation (`{{ removeError }}`), never `v-html`; a target line can carry a query string, so the message is treated like the saved list itself (the data dir is documented as sensitive).
- **Access control**: no authN/authZ on this endpoint — identical to `POST /api/sites/:id/targets` and every other mutating route. sakuda is a single-user, loopback-bound tool (`127.0.0.1:3001` in compose); this is the project's existing posture, not introduced here.
- **Frontend**: the new Remove control is a plain `<button>`; the Edit page swaps its `site` ref with the server's response, and `SiteForm` mirrors `initial.nucleiPaths` so a later "Save changes" cannot PUT stale text over a removal (regression that would silently re-add a removed target — covered by tests).
- **Secrets / logging**: none touched; no new log statements.

---

## False Positives

None — Semgrep (`p/typescript`, `p/nodejs`, `p/owasp-top-ten`, `p/secrets`) returned 0 results for the scope.

---

## Dependency Audit

Lockfile unchanged by this branch; `pnpm audit` state is as recorded in `feat-91-httpx-liveness-probe.20260910.md` (2 pre-existing `esbuild` dev-toolchain advisories, moderate/low).

---

## Remediation Priority

| Priority | Finding | Action                            |
| -------- | ------- | --------------------------------- |
| —        | none    | nothing outstanding in this scope |

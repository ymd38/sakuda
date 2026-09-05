# Security Audit: feat/36-katana-discovery — 2026-09-04

> Scope: `server/engines/katana/`, `server/engines/discover.ts`, `Dockerfile` (the diff of PR #40 against `main`; `server/config/env.ts`, `server/domain/headerCipher.ts` and `server/plugins/00.boot.ts` reviewed for the wiring) | Stack: TypeScript / Nuxt 4 + Nitro, `child_process.spawn` engine runner, katana 1.7.0 in the ZAP-based image | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified by the scan. One Low, defense-in-depth finding (V-01) was fixed in the same PR by the resolver, inside the agreed impact scope.

## Executive Summary

This change adds a second external process to the discovery job: the `katana` CLI, spawned with the site's seed URLs and (decrypted) auth headers, whose JSONL output is parsed and merged with ZAP's site tree. The attack surface to check is the argv boundary (command injection via URLs/headers), where the decrypted header values can end up (argv, logs, meta, files in the work dir), what the crawler is allowed to reach (SSRF scope), and the supply chain of the new binary. Semgrep (`p/default`, `p/nodejs`, `p/typescript`, `p/dockerfile`, `p/secrets`, `p/owasp-top-ten`, `p/security-audit`) reports no findings. Manual review found no Critical/High/Medium issue; one Low defense-in-depth gap — katana's JSONL persisted the target's response headers although only `method`/`endpoint`/`status_code` are read — was closed by adding `headers` to `-eof`.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 1 true positive (Low, fixed) | 0 false positives discarded

## Finding Summary

| ID   | Title                                                               | Severity | Location                           | Status                           |
| ---- | ------------------------------------------------------------------- | -------- | ---------------------------------- | -------------------------------- |
| V-01 | Target response headers persisted in `katana/urls.jsonl` (unneeded) | Low      | `server/engines/katana/args.ts:41` | True Positive — fixed in this PR |

## Findings

### V-01 — Target response headers persisted in `katana/urls.jsonl`

**Severity**: Low | **Location**: `server/engines/katana/args.ts:41` | **Confidence**: High

#### Vulnerable Code

```ts
// server/engines/katana/args.ts (before the fix)
'-eof', 'raw,body',
```

#### Attack Path

1. katana writes one JSONL line per crawled URL to `<data dir>/discoveries/<id>/katana/urls.jsonl`; with `raw,body` excluded each line still carried `response.headers`.
2. Against a target that sets cookies or exposes tokens in response headers, those values would sit on disk in the work dir for the lifetime of the discovery (the ZAP side of the job never stores response headers in its dump).
3. **Impact**: extra copy of target-side secrets on the operator's disk; not reachable through the API or UI (the parser only reads `method`, `endpoint`, `status_code`). Verified on the Juice Shop run: 0 `Set-Cookie`, 0 request headers, 0 occurrences of the `-H` Authorization value in the file — the request side was never persisted.

#### Risk Assessment

- **Severity**: Low (defense-in-depth; local disk only, no network exposure, no user-supplied secret involved)
- **Impact Area**: Engine work dir → local disk
- **Confidence**: High

#### Recommended Fix (applied)

Exclude `headers` too — `-eof raw,body,headers` (katana `-lof` lists it as an excludable field). Verified in the container: 209 lines either way, `status_code` still present, output 84 KB → 56 KB, and `-H` values absent from the file. `args.spec.ts` / `index.spec.ts` assert the exact argv.

## Manual Review

| Area                                       | What was checked                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| OS command injection (2.1)                 | `runKatanaCrawl` goes through `runCommand` (`spawn`, `shell: false`, argv array). User-influenced values reach argv only as `-H "name: value"` (names `/^[^\s:]+$/`, values `/^[^\r\n]*$/` from `shared/schemas/headers`) and as file paths built from the discovery id. Seed URLs are written to `seeds.txt` (`-list`), never interpolated into argv, so a URL containing a comma or a leading `-` cannot become a flag. | OK — no shell, no argv splitting on user data.                                   |
| Data exposure — header values (2.6)        | Start/done logs carry `headerNames` only; `meta.katana` has counts/durations only; `index.spec.ts` "never logs header values" captures pino output at `debug` and asserts the value is absent. `runCommand` strips `SAKUDA_ENCRYPTION_KEY` from the child env. katana's JSONL does not include request headers (verified: 0 `Bearer` in the run's file). Response headers: V-01, fixed.                                   | OK after V-01.                                                                   |
| SSRF / crawl scope (2.4)                   | katana crawls the site's `frontBaseUrl` like every other engine; `discoveryRunner` refuses non-local hosts without `nonLocalConfirmed` before any runner is called (unchanged gate). `-fs fqdn` keeps the crawl on the seed's host; the shared `normalizeCrawledEntries` drops off-origin results (`sameOriginOnly`). Loopback rewriting uses `env.localhostAlias` exactly as nuclei does.                                | OK — same trust model as nuclei; scope is narrower than ZAP's (front host only). |
| Partial failure / availability (REL)       | `Promise.allSettled`: a katana failure (ENOENT, timeout, non-zero exit) becomes a warning + `meta.katana.error` and the ZAP result is stored; a ZAP failure still fails the discovery. Timeout = spider minutes + grace, process group killed by `runCommand`; abort → `EngineError`. Both covered by `discover.spec.ts` / `index.spec.ts`.                                                                               | OK.                                                                              |
| Resource exhaustion                        | `-eof raw,body,headers` keeps the JSONL small (56 KB on Juice Shop vs 7.7 MB unfiltered); the merged list is capped at 500 by the shared normalizer; `-ct <minutes>` bounds the crawl and the hard timeout kills the process group.                                                                                                                                                                                       | OK.                                                                              |
| Supply chain (2.7) — new binary            | `Dockerfile`: `KATANA_VERSION=1.7.0` pinned, `katana-1.7.0-checksums.txt` fetched from the GitHub release and `sha256sum -c` enforced before `unzip`, both arches. Same recipe as nuclei; no `@latest`, no `go install` in the image. (Semgrep's Dockerfile parser reports a partial-parse on the pre-existing multi-name `ARG` line; it is valid BuildKit syntax and unchanged by this PR.)                              | OK.                                                                              |
| Secrets (2.3)                              | Semgrep `p/secrets`: none. Test fixtures use placeholders (`token=secret`, `Bearer very-secret`, `Bearer x`).                                                                                                                                                                                                                                                                                                             | OK.                                                                              |
| Frontend (2.5)                             | `DiscoveryPanel.vue` renders `row.url.source` as text interpolation (`{{ }}`), no `v-html`; only the empty-state copy changed.                                                                                                                                                                                                                                                                                            | OK.                                                                              |
| Input validation at the boundary (SEC/REL) | katana's JSONL is parsed with a zod schema (`request.endpoint` required, `response` optional); invalid lines are counted and surfaced as a warning, never thrown.                                                                                                                                                                                                                                                         | OK.                                                                              |

## Dependency Audit

No Node dependency changes in this PR (`pnpm-lock.yaml` untouched); the CI "Node Dependency Audit" and Trivy jobs on PR #40 pass. The new runtime dependency is the pinned, checksum-verified katana 1.7.0 binary (see Supply chain above).

## Remediation Priority

| Priority | Finding                                      | Action                                                           |
| -------- | -------------------------------------------- | ---------------------------------------------------------------- |
| P1       | V-01 response headers in `katana/urls.jsonl` | Done — `-eof raw,body,headers` (`server/engines/katana/args.ts`) |

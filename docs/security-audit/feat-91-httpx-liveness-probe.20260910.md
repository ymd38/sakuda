# Security Audit: feat/91-httpx-liveness-probe — 2026-09-10

> Scope: `server/engines/nuclei` (the httpx pre-scan probe added in #91 and its integration) | Stack: TypeScript / Nuxt (Nitro) / Node 22 | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified. Baseline: `main` (fe790a1).

---

## Executive Summary

The change adds one more external process (httpx) that sends GET requests to the operator's saved target URLs and writes its output to disk. It is built on the same guarded primitives as nuclei and katana (`runCommand`: no shell, argv array, process-group kill, `SAKUDA_ENCRYPTION_KEY` stripped from the child env), writes every artifact 0600, masks header values in the persisted argv, and pins the binary by version + checksum. Semgrep reports nothing in scope; the manual review found no regression. Two observations are recorded for context: the header-on-argv pattern is inherited from nuclei/katana (pre-existing), and the two `pnpm audit` advisories are in `esbuild` (dev toolchain, untouched by this diff).

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded | 2 informational notes (pre-existing)

---

## Finding Summary

| ID   | Title                                                                 | Severity      | Location                                   | Status                      |
| ---- | --------------------------------------------------------------------- | ------------- | ------------------------------------------ | --------------------------- |
| N-01 | Site headers passed to httpx on argv (`-H`)                           | Informational | `server/engines/nuclei/httpx/args.ts:44`   | Pre-existing pattern        |
| N-02 | httpx sends GETs to operator-saved URLs (same SSRF surface as nuclei) | Informational | `server/engines/nuclei/httpx/index.ts:101` | Pre-existing trust boundary |

---

## Findings

No true positives.

### N-01 — Site headers passed to httpx on argv (`-H`)

**Severity**: Informational | **Location**: `server/engines/nuclei/httpx/args.ts:44` | **Confidence**: High | **Class**: pre-existing pattern

The probe passes the site's request headers (Cookie / Authorization) as `-H name: value` arguments, exactly as `buildNucleiArgs` and `buildKatanaArgs` already do (`headersToHeaderArgs`). Argv is visible to other processes on the same host (`ps`, `/proc/<pid>/cmdline`) for the seconds the probe runs. The persisted `args.json` artifact masks the values (`redactHttpxArgs`, tested), so the disk copy is clean; only the live process list is exposed, which is the same exposure nuclei already has for the far longer signature phase. sakuda runs in its own container, so the process list is not shared with other tenants.

**Recommendation** (not for this PR — shared with nuclei/katana): httpx accepts a config file (`-config`), so the three tools could be moved to a 0600 config/`-H` file in one follow-up. Not a regression.

### N-02 — httpx sends GETs to operator-saved URLs

**Severity**: Informational | **Location**: `server/engines/nuclei/httpx/index.ts:101` | **Confidence**: High | **Class**: pre-existing trust boundary

The URL list httpx receives is the exact list nuclei receives (`expandNucleiTargets` → seeded → host-aliased), so the set of hosts sakuda will contact is unchanged by this PR. sakuda's documented trust model is that anyone reaching the port may configure targets (README "Trust model"); that boundary is not moved here. No redirect following (`-fr` absent, asserted by test), so httpx cannot be steered to a third host by the target's response. No `-kb` / page-type classifier, so no outbound model download at scan time (the reason for pinning ≥ 1.12).

---

## Manual Review Notes

- **Command injection**: `runCommand` spawns with `shell: false` and an argv array; target URLs never appear on argv (they go through `-l <file>`). Header values are on argv but never shell-interpreted.
- **Path traversal**: every artifact path is `join(workDir, 'httpx', <fixed name>)`; no user-controlled segment.
- **Secrets on disk**: `targets.txt` (may carry query values), `stdout.jsonl`, `stderr.log`, `args.json` are written 0600 and pre-created so httpx cannot create them under the umask (tested: mode `0o600` asserted for all four). `args.json` has header values masked (tested). Logs carry counts only (`droppedUrls` is stripped from the info log).
- **Environment**: `runCommand` drops `SAKUDA_ENCRYPTION_KEY` from the child env (unchanged).
- **Input validation at the boundary**: `SAKUDA_HTTPX_PRUNE_STATUS_CODES` is parsed by zod at startup — integers 400–499 only, 405/429 rejected — so a misconfiguration fails fast rather than silently widening what gets dropped. httpx's JSONL is parsed defensively (`asObservation`), one bad line is counted, not thrown.
- **Fail-open vs fail-closed**: the probe's failure modes (missing binary, non-zero exit, timeout) fail _open_ — every target goes to nuclei, i.e. the pre-#91 behaviour — with a warning. That is the safe direction for a coverage tool (nothing is silently skipped). An abort fails closed.
- **Supply chain**: `Dockerfile` pins `HTTPX_VERSION=1.12.0` and verifies the release zip against the upstream `httpx_1.12.0_checksums.txt` before install, same pattern as nuclei/katana. No `@latest`.
- **Authorization / business logic**: not applicable to this diff (no HTTP handlers changed).

---

## False Positives

None — Semgrep (`p/typescript`, `p/nodejs`, `p/secrets`, `p/owasp-top-ten`) returned 0 results for `server/engines/nuclei`.

---

## Dependency Audit

`pnpm audit` (lockfile unchanged by this branch):

| Package   | Advisory                                                   | Severity | Installed range                 | Fixed In   | Attribution  |
| --------- | ---------------------------------------------------------- | -------- | ------------------------------- | ---------- | ------------ |
| `esbuild` | dev server allows any website to send requests (GHSA-67mh) | Moderate | `<=0.24.2` (transitive)         | `>=0.25.0` | pre-existing |
| `esbuild` | arbitrary file read when running the dev server            | Low      | `>=0.27.3 <0.28.1` (transitive) | `>=0.28.1` | pre-existing |

Both are in the build/dev toolchain (not shipped in the image's runtime) and are present on `main` with the same lockfile. Out of this PR's scope; candidate for a separate dependency-bump issue.

---

## Remediation Priority

| Priority                     | Finding                                       | Action                                                               |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| —                            | none for this PR                              | —                                                                    |
| P2 (follow-up, pre-existing) | N-01 header-on-argv (nuclei / katana / httpx) | Move headers to a 0600 config file for all three tools in one change |
| P2 (follow-up, pre-existing) | esbuild advisories                            | Bump the transitive `esbuild` via the Nuxt/Vite toolchain update     |

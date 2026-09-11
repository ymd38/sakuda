# Security Audit: fix/95-headers-config-file — 2026-09-10

> Scope: `server/engines` + `server/domain/headerCipher.ts` (the header-delivery change for nuclei, katana and httpx, #95) | Stack: TypeScript / Nuxt (Nitro) / Node 22 | Auditor: Claude yds-vulnerability-scan skill
> Read-only inspection — no code was modified. Baseline: `main` (57918d1). Origin: finding N-01 of `feat-91-httpx-liveness-probe.20260910.md`.

---

## Executive Summary

The change removes the one place sakuda still put per-site secrets on a child process's command line: nuclei, katana and httpx now receive Cookie / Authorization headers through a 0600 JSON file passed as `-config`, written for the duration of the run and removed in `finally`. Semgrep reports nothing in scope; no runtime code path emits `-H` on argv any more (grep-verified). The finding this branch was opened for (N-01) is closed; no new finding was introduced.

**Critical/High findings requiring immediate action:** 0
**Total findings:** 0 true positives | 0 false positives discarded

---

## Finding Summary

| ID   | Title                                          | Severity | Location                            | Status                      |
| ---- | ---------------------------------------------- | -------- | ----------------------------------- | --------------------------- |
| N-01 | Site headers passed to child processes on argv | Low      | `server/domain/headerCipher.ts:133` | **Resolved by this change** |

---

## Manual Review Notes

- **Secret at rest during the run**: `headers.json` is created with `mode: 0o600` by the sakuda process itself (not by the tool under the umask), inside the engine's per-run work dir. `withHeadersConfig` removes it in `finally`, so a thrown `EngineError`, an abort or a timeout still cleans it up (tested: success, throw). A SIGKILL of the _sakuda_ process itself would leave the file behind — the same exposure the OpenAPI doc and dalfox config already have; the data dir is documented as sensitive.
- **argv**: the only header-related argv entry is now `-config <path>`. `grep "'-H'" server --include=*.ts` outside tests returns nothing; every args spec asserts `not.toContain('-H')`.
- **Injection into the config file**: values are serialised with `JSON.stringify`, so a header value containing quotes, newlines, `#` or `:` cannot break out of its string or introduce another config key (tested with `a="q"; b=c:d # not a comment`). A crafted header _name_ is still just a string element (`"Name: value"`), never a key.
- **Extra keys**: the file holds exactly one key (`header` / `headers`); no other flag can be smuggled through it, and a `-config` file cannot override CLI flags for the flags sakuda sets explicitly.
- **Default user config**: passing `-config` replaces `~/.config/<tool>/config.yaml`. The image ships none; a developer's own nuclei config would no longer be read during a sakuda run — a behaviour change worth knowing, not a vulnerability.
- **Environment**: unchanged — `runCommand` still strips `SAKUDA_ENCRYPTION_KEY` from the child env.
- **httpx `args.json`**: persisted unmasked now, which is safe because argv contains only the config path; the redaction helper was deleted rather than left as dead code.

---

## False Positives

None — Semgrep (`p/typescript`, `p/nodejs`, `p/secrets`, `p/owasp-top-ten`) returned 0 results for the scope.

---

## Dependency Audit

Lockfile unchanged by this branch; `pnpm audit` state is as recorded in `feat-91-httpx-liveness-probe.20260910.md` (2 pre-existing `esbuild` dev-toolchain advisories, moderate/low).

---

## Remediation Priority

| Priority | Finding | Action                                           |
| -------- | ------- | ------------------------------------------------ |
| —        | none    | N-01 resolved; nothing outstanding in this scope |

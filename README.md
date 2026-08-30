# sakuda

A self-hosted DAST (dynamic application security testing) app. Register a
**site**, run scans against it with **nuclei**, **ZAP API** (active scan
against an OpenAPI spec) and/or **ZAP frontend** (spider + baseline against a
seed page), and browse the results from the UI: per-engine findings, a
diff against the previous scan, Markdown export, and history charts.

MVP scope: sites → scans → per-engine reports. See
[Not in this MVP](#not-in-this-mvp) for what's deliberately out.

## Quick start (Docker)

Everything — the app, nuclei + templates, and ZAP — ships in one image.

```bash
docker build -t sakuda .

docker run -d --name sakuda -p 127.0.0.1:3000:3000 --shm-size=1g \
  --add-host=host.docker.internal:host-gateway \
  -e SAKUDA_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -v sakuda-data:/data \
  sakuda
```

Open http://localhost:3000.

- **Trust model: sakuda has no authentication.** Anyone who can reach the
  port can read/create/modify sites (including their configured headers) and
  start scans against arbitrary hosts. Bind it to loopback only (as above,
  `-p 127.0.0.1:3000:3000`) or put it behind an authenticating reverse proxy —
  never publish it directly (`-p 3000:3000` / `0.0.0.0`) on a shared or
  internet-facing host.
- **Keep the key.** `SAKUDA_ENCRYPTION_KEY` encrypts stored request headers
  (Cookie/Bearer/etc.) at rest. If you lose it, those headers become
  permanently unreadable — write it down somewhere safe (e.g. a password
  manager), it is not recoverable from the data volume.
- **Memory:** give Docker Desktop **6–8 GB** of RAM — the ZAP frontend engine
  (`zap-fe`) is the heaviest consumer and will fail or be OOM-killed on less.
- **Target URLs on your host machine**: when a site's base URL is
  `http://localhost:PORT` (or `127.0.0.1`), sakuda automatically rewrites it
  to `host.docker.internal` for engines running inside the container — no
  extra configuration needed, as long as the container was started with
  `--add-host=host.docker.internal:host-gateway` (as above).

## Environment variables

| Variable                      | Default                                                   | Notes                                                                                                                            |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SAKUDA_ENCRYPTION_KEY`       | _(required)_                                              | base64 of 32 random bytes. Generate with `pnpm keygen` or `openssl rand -base64 32`.                                             |
| `SAKUDA_DATA_DIR`             | `./data` (`/data` in the image)                           | SQLite DB + per-scan work dirs live here.                                                                                        |
| `SAKUDA_MIGRATIONS_DIR`       | `./server/db/migrations` (`/app/migrations` in the image) | Drizzle migrations applied on boot.                                                                                              |
| `SAKUDA_NUCLEI_BIN`           | `nuclei` (`/usr/local/bin/nuclei` in the image)           | Path to the nuclei binary.                                                                                                       |
| `SAKUDA_NUCLEI_TEMPLATES`     | `/opt/nuclei-templates/http`                              | Pinned nuclei-templates checkout.                                                                                                |
| `SAKUDA_NUCLEI_MAX_MINUTES`   | `60`                                                      | Hard timeout for a nuclei run.                                                                                                   |
| `SAKUDA_ZAP_CMD`              | `zap.sh` (`/zap/zap.sh` in the image)                     | ZAP entrypoint. Dev on macOS: `./scripts/zap-docker.sh`.                                                                         |
| `SAKUDA_ZAP_WORKDIR`          | _(unset)_                                                 | Container-side path when ZAP sees the scan work dir at a different path than the host (the dev wrapper mounts it at `/zap/wrk`). |
| `SAKUDA_ZAP_MAX_HEAP`         | `1024m`                                                   | `-Xmx` passed to ZAP via `JAVA_TOOL_OPTIONS`.                                                                                    |
| `SAKUDA_LOCALHOST_ALIAS`      | _(unset)_                                                 | Rewrites `localhost`/`127.0.0.1` in target URLs for all engines.                                                                 |
| `SAKUDA_ZAP_LOCALHOST_ALIAS`  | `host.docker.internal`                                    | Same, for ZAP only (falls back to `SAKUDA_LOCALHOST_ALIAS`).                                                                     |
| `SAKUDA_ENGINE_GRACE_MINUTES` | `10`                                                      | Grace period before an orphaned engine process is treated as failed.                                                             |
| `SAKUDA_JOB_RUNNER`           | `on`                                                      | Set `off` to disable the in-process scan queue (e.g. in tests).                                                                  |
| `LOG_LEVEL`                   | `info`                                                    | `debug` \| `info` \| `warn` \| `error`.                                                                                          |

Full defaults and validation: `server/config/env.ts`. See `.env.example` for
a copyable local `.env`.

## Local development

```bash
pnpm install
cp .env.example .env
pnpm keygen                 # paste the output into SAKUDA_ENCRYPTION_KEY in .env
```

nuclei runs as a native binary and ZAP runs via Docker in dev:

- Install nuclei locally (e.g. `go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`)
  and clone [nuclei-templates](https://github.com/projectdiscovery/nuclei-templates),
  then point `.env` at them: `SAKUDA_NUCLEI_BIN`, `SAKUDA_NUCLEI_TEMPLATES`.
- ZAP runs inside Docker via `scripts/zap-docker.sh` (no local ZAP install
  needed). Set in `.env`:
  ```
  SAKUDA_ZAP_CMD=./scripts/zap-docker.sh
  SAKUDA_ZAP_WORKDIR=/zap/wrk
  SAKUDA_ZAP_LOCALHOST_ALIAS=host.docker.internal
  ```
  Note: sending SIGKILL to the `docker run` client does not stop the ZAP
  container — SIGTERM is proxied through to it, and sakuda's engine runner
  sends SIGTERM first, so a graceful stop/timeout works as expected.

Then:

```bash
pnpm dev            # http://localhost:3000
pnpm test           # unit + component tests
pnpm test:e2e       # API e2e tests
pnpm run lint
pnpm run typecheck
```

## Scan data on disk

`data/scans/<scanId>/<engine>/` keeps each engine's raw logs and reports
(stdout/stderr, ZAP's plan/report JSON, nuclei's JSONL output). This can
contain target application data (response fragments, discovered paths) —
treat the `data/` directory as sensitive, do not commit it or share it
outside the team that owns the scanned target.

**Retention model:** there is no per-scan expiry — a site's scan artifacts
live on disk for as long as the site exists, and are deleted (best-effort)
when the site itself is deleted.

## Not in this MVP

- Target ownership verification (file/DNS challenge)
- Login automation / authenticated crawling flows
- Scheduled/recurring scans
- Notifications (email/Slack/etc.)
- Multi-user accounts or access control

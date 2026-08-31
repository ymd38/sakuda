# sakuda

A self-hosted DAST (dynamic application security testing) app. Register a
**site**, run scans against it with **nuclei**, **ZAP API** (active scan
against an OpenAPI spec) and/or **ZAP frontend** (spider + baseline against a
seed page), and browse the results from the UI: per-engine findings, a
diff against the previous scan, Markdown export, and history charts.
**Discovery** is separate from scanning: ZAP's spider crawls the site, you
review the URLs it found and save the ones you want as target paths, and
nuclei scans that saved list on every run — no need to crawl again until the
site changes.

MVP scope: sites → scans → per-engine reports. See
[Not in this MVP](#not-in-this-mvp) for what's deliberately out.

## Quick start (Docker)

Everything — the app, nuclei + templates, and ZAP — ships in one image.
`docker-compose.yml` + `Makefile` wrap the commands; every port and secret is
read from `.env`.

```bash
make env      # .env from .env.example with a fresh SAKUDA_ENCRYPTION_KEY
make build    # build the image (10–20 min the first time)
make up       # start → http://localhost:3001
make logs     # follow logs · make restart · make ps
make sakuda-down && make sakuda-up   # recreate only sakuda (e.g. after make build) — Juice Shop keeps running
make down     # stops everything incl. Juice Shop, which resets its accounts on the next start
```

`make help` lists every target. Without make:

```bash
docker compose up -d sakuda          # same thing, reads .env
# or plain docker:
docker build -t sakuda .
docker run -d --name sakuda -p 127.0.0.1:3001:3000 --shm-size=1g \
  --add-host=host.docker.internal:host-gateway \
  -e SAKUDA_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -v sakuda-data:/data \
  sakuda
```

### Ports

The container always listens on **3000**; the host-side ports come from
`.env` so sakuda can coexist with other local stacks:

| `.env` variable  | Default     | What                                                     |
| ---------------- | ----------- | -------------------------------------------------------- |
| `SAKUDA_PORT`    | `3001`      | sakuda UI/API (`make up`, `make dev`)                    |
| `JUICESHOP_PORT` | `4001`      | OWASP Juice Shop dry-run target (`make juice-up`)        |
| `SAKUDA_BIND`    | `127.0.0.1` | Bind address for published ports — keep it loopback-only |

Override per invocation with `make up SAKUDA_PORT=3005`.

- **Trust model: sakuda has no authentication.** Anyone who can reach the
  port can read/create/modify sites (including their configured headers) and
  start scans against arbitrary hosts. Bind it to loopback only (the default
  `SAKUDA_BIND=127.0.0.1`) or put it behind an authenticating reverse proxy —
  never publish it on `0.0.0.0` on a shared or internet-facing host.
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
make env                    # .env with a fresh key (or: cp .env.example .env && pnpm keygen)
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
make dev            # nuxt dev on SAKUDA_PORT → http://localhost:3001
make test           # unit + component tests
make e2e            # API e2e tests
make lint · make typecheck · make check (all three)
make juice-up       # Juice Shop on JUICESHOP_PORT as a scan target
```

(`pnpm dev --port 3001`, `pnpm test`, `pnpm test:e2e`, `pnpm run lint`,
`pnpm run typecheck` underneath.)

## Scan data on disk

`data/scans/<scanId>/<engine>/` keeps each engine's raw logs and reports
(stdout/stderr, ZAP's plan/report JSON, nuclei's JSONL output). This can
contain target application data (response fragments, discovered paths) —
treat the `data/` directory as sensitive, do not commit it or share it
outside the team that owns the scanned target.

**Retention model:** there is no per-scan expiry — a site's scan artifacts
live on disk for as long as the site exists, and are deleted (best-effort)
when the site itself is deleted.

## Discovery — filling the target list

Nuclei does not crawl; it scans exactly the **target paths** saved on the
site (`/path` or `api:/path`, relative to the base URLs). On the site page:

1. **Discover URLs** runs ZAP's traditional + Ajax spiders from the seed path
   (each for up to `zapFeSpiderMaxMinutes`, with the site's headers) and dumps
   ZAP's site tree — every URL the crawl requested, not only the ones that
   raised an alert. Off-origin URLs, static assets, socket.io transports,
   stack-trace pseudo-paths and `excludePaths` matches are dropped; the panel
   shows how many and why.
2. Tick the URLs you want scanned (everything not yet saved is pre-selected),
   add paths by hand if you like, and **Save to targets**. Saving appends to
   the list and never duplicates a path.
3. Start a scan. Nuclei uses the saved list; ZAP frontend still crawls from
   the seed path itself.

**Single-page apps behind a login.** Header injection authenticates the
_requests_, but an SPA decides whether it is logged in from what it finds in
`localStorage` / `sessionStorage` / cookies — so with headers alone ZAP's
browser renders the anonymous UI and never reaches the basket, profile, …
pages or the APIs behind them. Register those values as **Browser storage**
on the site (kind + name + value; stored encrypted like headers, write-only
in the API) and sakuda seeds them into ZAP's browser before every Ajax
spider run (discovery and ZAP frontend) via a Selenium `browserLaunched`
script that is written 0600 for the run and deleted afterwards. For OWASP
Juice Shop that is `localStorage token = <JWT>` plus `sessionStorage bid =
<basket id>` from `POST /rest/user/login`.

**Discovery seeds.** _Discovery seed paths_ (one per line, hash routes such
as `/#/search?q=apple` are fine) start one Ajax spider each; empty falls
back to the ZAP frontend seed path.

A site runs one job at a time: a discovery is refused while a scan is
queued/running and vice versa. Discovery artifacts (ZAP plan, logs, the
site-tree dump) live under `<data dir>/discoveries/<id>` and are removed with
the site.

## Not in this MVP

- Target ownership verification (file/DNS challenge)
- Login automation / authenticated crawling flows
- Scheduled/recurring scans
- Notifications (email/Slack/etc.)
- Multi-user accounts or access control

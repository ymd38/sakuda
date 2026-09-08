# syntax=docker/dockerfile:1.7
#
# Single-image deliverable: builds the Nuxt app on Node, then layers a
# checksum-verified Node runtime + nuclei + nuclei-templates onto the
# official ZAP image so nuclei, ZAP and the app share one container.
#
# Versions verified before pinning (see task-15-report.md for how):
#   - ZAP_VERSION: ghcr.io/zaproxy/zaproxy:2.17.0 (manifest confirmed)
#   - NODE_VERSION: 22.23.2 (latest Node 22 "Jod" LTS, nodejs.org/dist/index.json)
#   - NUCLEI_VERSION: 3.11.1 (github.com/projectdiscovery/nuclei latest release)
#   - NUCLEI_TEMPLATES_TAG: v10.4.8 (github.com/projectdiscovery/nuclei-templates latest release)
#   - KATANA_VERSION: 1.7.0 (github.com/projectdiscovery/katana latest release)
#   - ASCANRULES_BETA_VERSION: 64 (zap-extensions ascanrulesBeta-v64, requires ZAP>=2.17.0)
ARG ZAP_VERSION=2.17.0
ARG NODE_VERSION=22.23.2
ARG NUCLEI_VERSION=3.11.1
ARG NUCLEI_TEMPLATES_TAG=v10.4.8
ARG KATANA_VERSION=1.7.0
ARG ASCANRULES_BETA_VERSION=64

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 ships a binding.gyp, which pnpm auto-builds via node-gyp on
# install regardless of any bundled prebuild; node:*-slim has no toolchain.
# Built for the build stage's own arch (linux/arm64 or linux/amd64) here —
# never copied in from the macOS host.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ghcr.io/zaproxy/zaproxy:${ZAP_VERSION}
ARG ZAP_VERSION NODE_VERSION NUCLEI_VERSION NUCLEI_TEMPLATES_TAG KATANA_VERSION ASCANRULES_BETA_VERSION TARGETARCH
USER root

# ZAP's Debian base already ships curl, unzip and git; if that ever changes,
# install them here (apt-get, --no-install-recommends, cleaned lists).

# Node (official tarball, checksum-verified; TARGETARCH amd64->x64)
RUN set -eux; arch="$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64)"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${arch}.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-linux-${arch}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f node-v* SHASUMS256.txt; node --version

# nuclei (checksum-verified) + pinned templates
RUN set -eux; \
    curl -fsSLO "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip"; \
    curl -fsSLO "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_checksums.txt"; \
    grep "nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip" "nuclei_${NUCLEI_VERSION}_checksums.txt" | sha256sum -c -; \
    unzip -o "nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip" nuclei -d /usr/local/bin; chmod 755 /usr/local/bin/nuclei; rm -f nuclei_*; \
    git clone --depth 1 --branch "${NUCLEI_TEMPLATES_TAG}" https://github.com/projectdiscovery/nuclei-templates /opt/nuclei-templates; \
    rm -rf /opt/nuclei-templates/.git

# katana (checksum-verified; static crawl only, no headless browser). Note the
# checksums asset is `katana-<ver>-checksums.txt` (hyphens), unlike nuclei's.
RUN set -eux; \
    curl -fsSLO "https://github.com/projectdiscovery/katana/releases/download/v${KATANA_VERSION}/katana_${KATANA_VERSION}_linux_${TARGETARCH}.zip"; \
    curl -fsSLO "https://github.com/projectdiscovery/katana/releases/download/v${KATANA_VERSION}/katana-${KATANA_VERSION}-checksums.txt"; \
    grep "katana_${KATANA_VERSION}_linux_${TARGETARCH}.zip" "katana-${KATANA_VERSION}-checksums.txt" | sha256sum -c -; \
    unzip -o "katana_${KATANA_VERSION}_linux_${TARGETARCH}.zip" katana -d /usr/local/bin; chmod 755 /usr/local/bin/katana; rm -f katana_* katana-*

# ZAP ascanrulesBeta add-on (NoSQL(MongoDB)/LDAP injection active scan rules).
# Pinned by version + SHA-256 and dropped into /zap/plugin/ so ZAP loads it at
# startup without any runtime marketplace fetch (offline / reproducible, per
# ADR-0002). ZAP add-on releases ship no checksums file, so the hash is pinned
# here the same way the Node tarball's is.
ARG ASCANRULES_BETA_SHA256=473987bfdede353167483d69ab4725b2509dd3c9a4b3426708dce1b26802e414
RUN set -eux; \
    # ascanrulesBeta-v64 requires ZAP >= 2.17.0; fail the build fast if
    # ZAP_VERSION was overridden to an older base rather than shipping an image
    # whose ZAP cannot load the add-on.
    dpkg --compare-versions "${ZAP_VERSION}" ge "2.17.0"; \
    zap="ascanrulesBeta-beta-${ASCANRULES_BETA_VERSION}.zap"; \
    curl -fsSLO "https://github.com/zaproxy/zap-extensions/releases/download/ascanrulesBeta-v${ASCANRULES_BETA_VERSION}/${zap}"; \
    echo "${ASCANRULES_BETA_SHA256}  ${zap}" | sha256sum -c -; \
    # Drop any other ascanrulesBeta the base image might carry so the pinned
    # version is the only one ZAP can load (reproducibility).
    rm -f /zap/plugin/ascanrulesBeta-*.zap; \
    install -o zap -g zap -m 644 "${zap}" "/zap/plugin/${zap}"; \
    rm -f "${zap}"; \
    ls -1 "/zap/plugin/${zap}"

WORKDIR /app
COPY --from=build --chown=zap:zap /app/.output ./.output
COPY --chown=zap:zap server/db/migrations ./migrations
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/sakuda-entrypoint
RUN mkdir -p /data && chown zap:zap /data /app
USER zap
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 HOME=/home/zap \
    SAKUDA_DATA_DIR=/data SAKUDA_MIGRATIONS_DIR=/app/migrations \
    SAKUDA_NUCLEI_BIN=/usr/local/bin/nuclei SAKUDA_NUCLEI_TEMPLATES=/opt/nuclei-templates/http \
    SAKUDA_NUCLEI_DAST_TEMPLATES=/opt/nuclei-templates/dast \
    SAKUDA_KATANA_BIN=/usr/local/bin/katana \
    SAKUDA_ZAP_CMD=/zap/zap.sh SAKUDA_LOCALHOST_ALIAS=host.docker.internal
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["sakuda-entrypoint"]

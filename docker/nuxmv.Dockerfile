ARG BASE=debian:trixie-slim

FROM ${BASE} AS unpack

RUN apt-get update && apt-get install -y --no-install-recommends \
        xz-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/nuxmv
COPY vendor/nuXmv-*.tar.* ./
RUN set -eux; \
    f="$(ls nuXmv-*.tar.*)"; \
    mkdir -p /opt/nuxmv; \
    tar xf "$f" -C /opt/nuxmv --strip-components=1; \
    bin="$(find /opt/nuxmv -type f -name nuXmv -perm -u+x | head -n1)"; \
    test -n "$bin"; \
    lib="$(find /opt/nuxmv -name 'libnuxmv.*' | head -n1)"; \
    if [ -n "$lib" ]; then ln -sfn "$(dirname "$lib")" /opt/nuxmv/lib; \
    else mkdir -p /opt/nuxmv/lib; fi; \
    ln -sf "$bin" /opt/nuxmv/nuXmv

FROM ${BASE}

ARG NUXMV_VERSION=2.2.0
LABEL org.opencontainers.image.title="nuXmv" \
      org.opencontainers.image.version="${NUXMV_VERSION}" \
      org.opencontainers.image.licenses="LicenseRef-nuXmv-noncommercial" \
      org.opencontainers.image.description="nuXmv model checker. Non-commercial/academic use only. Do not publish."

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
        libstdc++6 libxml2 libgmp10 libedit2 liblzma5 libncursesw6 zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY --from=unpack /opt/nuxmv /opt/nuxmv

RUN set -eux; \
    echo "--- ldd against system libraries ---"; \
    ldd /opt/nuxmv/nuXmv || true; \
    printf 'MODULE main\nVAR b : boolean;\nASSIGN init(b) := TRUE; next(b) := b;\nSPEC AG b\n' > /tmp/smoke.smv; \
    if /opt/nuxmv/nuXmv /tmp/smoke.smv 2>/dev/null | grep -q 'is true'; then \
        echo "linking against system libraries"; \
        printf '#!/bin/sh\nexec /opt/nuxmv/nuXmv "$@"\n' > /usr/local/bin/nuXmv; \
    else \
        echo "falling back to the bundled runtime"; \
        printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/opt/nuxmv/lib /opt/nuxmv/nuXmv "$@"\n' > /usr/local/bin/nuXmv; \
    fi; \
    chmod 0755 /usr/local/bin/nuXmv; \
    nuXmv /tmp/smoke.smv | grep -q 'is true'; \
    rm /tmp/smoke.smv

RUN useradd --create-home --uid 10001 verifier
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["nuXmv"]

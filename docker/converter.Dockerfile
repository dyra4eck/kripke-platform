# syntax=docker/dockerfile:1.7
#
# The converter alone. No nuXmv here, so this image is safe to publish.
#
# Same base as the nuXmv image so the two runtimes cannot drift apart.
ARG BASE=debian:trixie-slim

FROM ${BASE} AS build

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ cmake make ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY cmake/ cmake/
COPY src/ src/
COPY examples/ examples/

# Golden tests run during the build: a broken converter never becomes an image.
RUN cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DSTATIC_LINK=ON \
    && cmake --build build -j"$(nproc)" \
    && ctest --test-dir build --output-on-failure

FROM ${BASE}

LABEL org.opencontainers.image.source="https://github.com/dyra4eck/kripke-platform" \
      org.opencontainers.image.title="kripke-converter" \
      org.opencontainers.image.description="Kripke model JSON -> nuXmv SMV converter"

COPY --from=build /src/build/kripke_generator /usr/local/bin/kripke_generator

RUN useradd --create-home --uid 10001 converter
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["kripke_generator"]

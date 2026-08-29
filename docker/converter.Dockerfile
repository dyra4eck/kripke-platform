ARG BASE=debian:trixie-slim

FROM ${BASE} AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ cmake make ca-certificates nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY cmake/ cmake/
COPY src/ src/
COPY examples/ examples/

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

# syntax=docker/dockerfile:1.7
#
# The whole chain in one image: validate -> convert -> model-check.
# Used both as the CI job container and as the backend's worker sandbox.
#
# Contains nuXmv, therefore PRIVATE.
#
#   docker build -f docker/pipeline.Dockerfile \
#     --build-arg NUXMV_IMAGE=ghcr.io/dyra4eck/nuxmv:2.2.0 \
#     --build-arg CONVERTER_IMAGE=ghcr.io/dyra4eck/kripke-converter:latest \
#     -t ghcr.io/dyra4eck/kripke-pipeline:latest .
#
ARG NUXMV_IMAGE=ghcr.io/dyra4eck/nuxmv:2.2.0
ARG CONVERTER_IMAGE=ghcr.io/dyra4eck/kripke-converter:latest

FROM ${CONVERTER_IMAGE} AS converter
FROM ${NUXMV_IMAGE}

USER root
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-jsonschema \
    && rm -rf /var/lib/apt/lists/*

COPY --from=converter /usr/local/bin/kripke_generator /usr/local/bin/kripke_generator
COPY scripts/ /opt/pipeline/scripts/
COPY schemas/ /opt/pipeline/schemas/
RUN chmod 0755 /opt/pipeline/scripts/run_pipeline.sh /opt/pipeline/scripts/validate_model.py

ENV KRIPKE_SCHEMA=/opt/pipeline/schemas/kripke.schema.json \
    NUXMV_CMD=/opt/pipeline/scripts/verify.cmd

# Same self-check as the base image, now through the full tool set.
RUN set -eux; \
    command -v nuXmv; \
    command -v kripke_generator; \
    python3 -c 'import jsonschema; print(jsonschema.__version__)'

USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/opt/pipeline/scripts/run_pipeline.sh"]

# syntax=docker/dockerfile:1.7
#
# The API. Built on the pipeline image, so it inherits the converter, the
# validator and nuXmv -- therefore PRIVATE.
#
ARG PIPELINE_IMAGE=ghcr.io/dyra4eck/kripke-pipeline:latest
FROM ${PIPELINE_IMAGE}

USER root
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

COPY backend/ /opt/backend/

# runner.py resolves these relative to the repo root by default, which does
# not exist in this image.
ENV KRIPKE_SCRIPTS=/opt/pipeline/scripts \
    KRIPKE_SCHEMA=/opt/pipeline/schemas/kripke.schema.json \
    NUXMV_CMD=/opt/pipeline/scripts/verify.cmd \
    PYTHONPATH=/opt/backend \
    PYTHONUNBUFFERED=1

USER 10001:10001
WORKDIR /opt/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

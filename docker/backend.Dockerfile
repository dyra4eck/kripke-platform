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
        python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# A virtualenv rather than --break-system-packages: the base image installs
# python3-jsonschema through apt, and pip cannot upgrade a dpkg-owned
# dependency (rpds-py) -- it fails with uninstall-no-record-file. The venv
# gets its own site-packages and the conflict disappears.
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY backend/ /opt/backend/
RUN chmod -R a+rX /opt/backend
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
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"]

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

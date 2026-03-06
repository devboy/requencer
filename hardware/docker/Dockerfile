FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TARGETARCH

# ── Layer 1: System packages + KiCad 9 from PPA ──────────────────────
# This layer is large but rarely changes.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        software-properties-common && \
    add-apt-repository -y ppa:kicad/kicad-9.0-releases && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        kicad \
        make \
        git \
        wget \
        curl \
        ca-certificates \
        cmake \
        build-essential && \
    # python3-pcbnew is a separate package on amd64, bundled in kicad on arm64
    apt-get install -y --no-install-recommends python3-pcbnew 2>/dev/null || true && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# ── Layer 2: Eclipse Temurin JRE 21 (FreeRouting needs Java 21) ──────
# Architecture-aware download.
RUN case "${TARGETARCH}" in \
        amd64) JRE_ARCH="x64" ;; \
        arm64) JRE_ARCH="aarch64" ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    wget -qO /tmp/jre.tar.gz \
        "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jre_${JRE_ARCH}_linux_hotspot_21.0.6_7.tar.gz" && \
    mkdir -p /opt/java && \
    tar -xzf /tmp/jre.tar.gz -C /opt/java --strip-components=1 && \
    rm /tmp/jre.tar.gz
ENV PATH="/opt/java/bin:${PATH}"

# ── Layer 3: FreeRouting JAR ─────────────────────────────────────────
# Architecture-independent, changes rarely.
RUN wget -q -O /opt/freerouting.jar \
    https://github.com/freerouting/freerouting/releases/download/v2.1.0/freerouting-2.1.0.jar

# ── Layer 4: uv + Python 3.14 + atopile ─────────────────────────────
# atopile 0.14.x requires Python >=3.14. We use uv to install a
# standalone Python 3.14 alongside the system Python 3.12 (which has
# pcbnew bindings). This mirrors the atopile-kicad image approach.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN uv python install 3.14 && \
    uv tool install --python 3.14 atopile

# Put uv tool bin on PATH so `ato` is available
ENV PATH="/root/.local/bin:${PATH}"

# ── Environment for scripts (Linux paths) ────────────────────────────
ENV KICAD_PYTHON=python3
ENV KICAD_PYPATH=""
ENV KICAD_FWPATH=""
ENV KICAD_CLI=kicad-cli
ENV JAVA=java
ENV FREEROUTING_JAR=/opt/freerouting.jar
ENV NONINTERACTIVE=1

WORKDIR /work

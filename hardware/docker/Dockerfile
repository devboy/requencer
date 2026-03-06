# Base on atopile's official image which bundles KiCad 9 + pcbnew + atopile
# Version must match requires-atopile in hardware/ato.yaml (^0.14.0)
ARG ATOPILE_VERSION=0.14.3
FROM ghcr.io/atopile/atopile-kicad:${ATOPILE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

# Add build tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        make \
        git \
        wget \
        ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Eclipse Temurin JRE 21 (FreeRouting 2.1.0 requires Java 21)
RUN wget -qO /tmp/jre.tar.gz \
        "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.6_7.tar.gz" && \
    mkdir -p /opt/java && \
    tar -xzf /tmp/jre.tar.gz -C /opt/java --strip-components=1 && \
    rm /tmp/jre.tar.gz
ENV PATH="/opt/java/bin:${PATH}"

# FreeRouting JAR
RUN wget -q -O /opt/freerouting.jar \
    https://github.com/freerouting/freerouting/releases/download/v2.1.0/freerouting-2.1.0.jar

# Environment variables for scripts (Linux paths)
ENV KICAD_PYTHON=python3
ENV KICAD_PYPATH=""
ENV KICAD_FWPATH=""
ENV KICAD_CLI=kicad-cli
ENV JAVA=java
ENV FREEROUTING_JAR=/opt/freerouting.jar

# Override atopile entrypoint so we can run arbitrary commands
ENTRYPOINT []

WORKDIR /work

# Túnel P2P Dahua/Intelbras -> RTSP local, baseado no dh-p2p (MIT, prova de conceito).
# Compila no próprio Pi (ARM64) ou em x86_64. Primeira build leva alguns minutos.
FROM rust:1-bookworm AS build
ARG DH_P2P_REPO=https://github.com/khoanguyen-3fc/dh-p2p.git
ARG DH_P2P_COMMIT=9158ed08b74cdd153ae5dfe40bf13b247b573ffc
WORKDIR /src
RUN git clone "$DH_P2P_REPO" . && git checkout --quiet "$DH_P2P_COMMIT"
COPY patch-dh-p2p.py /tmp/patch-dh-p2p.py
RUN python3 /tmp/patch-dh-p2p.py src/dh.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/dh-p2p /usr/local/bin/dh-p2p
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

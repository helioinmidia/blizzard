#!/bin/sh
# Variáveis (definidas no docker-compose / .env):
#   INTELBRAS_SERIAL   número de série do gravador (obrigatório)
#   DH_P2P_SERVER      servidor P2P (padrão do binário: Easy4IP; Intelbras: intelbrasp2p.com.br:8800)
#   P2P_BIND           endereço:porta local onde o RTSP do gravador aparece (padrão 127.0.0.1:1554)
#   P2P_REMOTE_PORT    porta remota no gravador (padrão 554 = RTSP)
#   DH_P2P_RELAY       "1" para forçar o modo relay (experimental; útil atrás de CGNAT)
set -eu
: "${INTELBRAS_SERIAL:?defina INTELBRAS_SERIAL com o número de série do gravador}"
BIND="${P2P_BIND:-127.0.0.1:1554}"
REMOTE="${P2P_REMOTE_PORT:-554}"
set -- dh-p2p -p "${BIND}:${REMOTE}"
if [ "${DH_P2P_RELAY:-0}" = "1" ]; then set -- "$@" --relay; fi
echo "dh-p2p: serial=${INTELBRAS_SERIAL} servidor=${DH_P2P_SERVER:-www.easy4ipcloud.com:8800} local=${BIND} -> remoto:${REMOTE}"
exec "$@" "${INTELBRAS_SERIAL}"

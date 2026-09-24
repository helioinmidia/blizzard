#!/usr/bin/env bash
# Abre a central em modo quiosque no Chromium, ocupando a TV inteira.
# Chamado pelo autostart da sessão gráfica do Raspberry Pi (ver pi/install.sh).
set -u

# Parâmetros por tela: sidebar=0 esconde o painel lateral (mais espaço para as células numa TV),
# scale=1.15 amplia a interface para leitura à distância, view=<id> abre direto numa visão.
URL="${BLIZZARD_URL:-http://localhost/?sidebar=0&scale=1.15}"

# Espera o servidor web da central responder (o Docker pode subir depois da sessão gráfica).
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$URL"; then break; fi
  sleep 2
done

# Sem descanso de tela no X11 (no Wayland o install.sh já desliga via raspi-config).
if [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null 2>&1; then
  xset s off; xset s noblank; xset -dpms
fi

BROWSER=""
for candidate in chromium-browser chromium; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "Chromium não encontrado. Instale com: sudo apt install -y chromium-browser" >&2
  exit 1
fi

# Remove a marca de "encerrado incorretamente" para não aparecer a barra de restaurar sessão.
PROFILE="$HOME/.config/blizzard-kiosk"
mkdir -p "$PROFILE"

# Trava de perfil órfã (queda de energia, ou o hostname do Pi mudou): o Chromium abriria um diálogo
# "profile appears to be in use" e a TV ficaria parada nele. Sem nenhum Chromium usando este perfil, remove.
if ! pgrep -u "$(id -u)" -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; then
  rm -f "$PROFILE"/Singleton*
fi
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' \
  "$PROFILE/Default/Preferences" 2>/dev/null || true

exec "$BROWSER" \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  --start-maximized

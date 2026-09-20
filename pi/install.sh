#!/usr/bin/env bash
# Instalação da Blizzard num Raspberry Pi 4 (Raspberry Pi OS 64 bits com desktop).
#
#   git clone https://github.com/helioinmidia/blizzard.git ~/blizzard
#   cd ~/blizzard && ./pi/install.sh
#
# O que faz:
#   1. instala Docker (se faltar) e coloca o usuário no grupo docker;
#   2. sobe go2rtc + servidor web da central com docker compose (reinicia sozinho no boot);
#   3. instala Chromium e configura a sessão gráfica para abrir a central em quiosque no boot;
#   4. desliga o descanso de tela e ativa login automático no desktop;
#   5. define o hostname do Pi (BLIZZARD_HOST, padrão view.blizzard.net).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"
USER_NAME="${SUDO_USER:-$USER}"
BLIZZARD_HOST="${BLIZZARD_HOST:-view.blizzard.net}"
SHORT_HOST="${BLIZZARD_HOST%%.*}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Execute como usuário normal (o script pede sudo quando precisar)." >&2
  exit 1
fi

echo "==> Hostname: $BLIZZARD_HOST"
sudo hostnamectl set-hostname "$BLIZZARD_HOST"
# Mantém o nome curto e o FQDN resolvendo localmente (sudo e serviços reclamam sem isso).
if grep -qE "^127\.0\.1\.1\s" /etc/hosts; then
  sudo sed -i -E "s/^127\.0\.1\.1\s.*/127.0.1.1\t$BLIZZARD_HOST $SHORT_HOST/" /etc/hosts
else
  echo -e "127.0.1.1\t$BLIZZARD_HOST $SHORT_HOST" | sudo tee -a /etc/hosts >/dev/null
fi

echo "==> Pacotes base"
sudo apt-get update
sudo apt-get install -y curl git ca-certificates chromium-browser || sudo apt-get install -y curl git ca-certificates chromium

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER_NAME"
sudo systemctl enable --now docker

if [ ! -f "$REPO_DIR/go2rtc/go2rtc.yaml" ]; then
  echo "==> Criando go2rtc/go2rtc.yaml a partir do exemplo (edite-o com as câmeras reais)"
  cp "$REPO_DIR/go2rtc/go2rtc.example.yaml" "$REPO_DIR/go2rtc/go2rtc.yaml"
fi

# A API de configuração grava public/config/blizzard.config.json com o seu usuário (não como root).
printf 'BLIZZARD_UID=%s\nBLIZZARD_GID=%s\n' "$(id -u "$USER_NAME")" "$(id -g "$USER_NAME")" > "$REPO_DIR/.env"

echo "==> Subindo containers (primeira build pode levar alguns minutos no Pi)"
sudo docker compose -f "$REPO_DIR/docker-compose.yml" up -d --build

echo "==> Autostart do quiosque"
AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/blizzard-kiosk.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Blizzard Kiosk
Comment=Central de Monitoramento em tela cheia
Exec=$REPO_DIR/pi/kiosk.sh
X-GNOME-Autostart-enabled=true
DESKTOP

if command -v raspi-config >/dev/null 2>&1; then
  echo "==> Login automático no desktop e descanso de tela desligado"
  sudo raspi-config nonint do_boot_behaviour B4 || true
  sudo raspi-config nonint do_blanking 1 || true
fi

cat <<MSG

Pronto. Reinicie o Pi (sudo reboot): a TV deve abrir a central sozinha.

Próximos passos:
  - Edite go2rtc/go2rtc.yaml com as URLs reais das câmeras e reinicie o go2rtc:
      sudo docker compose restart go2rtc
  - Edite public/config/blizzard.config.json (fontes e visões) e recarregue a página.
  - Acesse de outro dispositivo da rede: http://$BLIZZARD_HOST/  (ou http://$(hostname -I | awk '{print $1}')/)
    Para o nome resolver na rede, aponte $BLIZZARD_HOST para o IP do Pi no DNS do roteador,
    no Pi-hole ou na zona pública de blizzard.net (registro A com o IP local). Veja o README.
  - Painel do go2rtc (diagnóstico de streams): http://$BLIZZARD_HOST:1984/
MSG

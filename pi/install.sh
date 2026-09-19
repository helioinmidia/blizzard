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
#   4. desliga o descanso de tela e ativa login automático no desktop.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"
USER_NAME="${SUDO_USER:-$USER}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Execute como usuário normal (o script pede sudo quando precisar)." >&2
  exit 1
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
  echo "Falta go2rtc/go2rtc.yaml. Crie a partir do exemplo do repositório." >&2
  exit 1
fi

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
  - Acesse de outro dispositivo da rede: http://$(hostname -I | awk '{print $1}'):8080/
  - Painel do go2rtc (diagnóstico de streams): http://$(hostname -I | awk '{print $1}'):1984/
MSG

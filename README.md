# Blizzard · Central de Monitoramento

Video wall para TV que reúne, numa única tela:

- **Câmeras da casa** — UniFi Protect (UDM / UNVR / Cloud Key)
- **Câmeras do condomínio** — DVR/NVR e câmeras Intelbras
- **Painéis do Home Assistant** — qualquer dashboard, embutido ao vivo

Roda inteiro num **Raspberry Pi 4** ligado à TV por HDMI. Nada depende de laptop ou celular: o Pi
serve a página, converte os streams das câmeras para o navegador e abre o Chromium em modo quiosque no boot.

## Como funciona

```
Câmeras UniFi (RTSPS) ─┐
Câmeras Intelbras (RTSP) ┼─▶ go2rtc ─▶ WebRTC / MSE ─▶ Chromium (quiosque) ─▶ TV
Home Assistant (iframe) ─┘              ▲
                                  Blizzard web (nginx + React)
```

| Peça | Função |
| --- | --- |
| [go2rtc](https://github.com/AlexxIT/go2rtc) | Recebe RTSP/RTSPS das câmeras e entrega ao navegador via WebRTC (ou MSE/HLS como fallback), sem transcodificar. |
| Blizzard web | Aplicação React (este repositório) servida por nginx, que também faz proxy de `/go2rtc` para o go2rtc e de `/api` para a API de configuração. |
| API de configuração | `server/config-api.py` (Python, sem dependências): lê e grava `public/config/blizzard.config.json`. Toda alteração feita na tela é salva aqui, nunca no navegador. |
| Chromium em quiosque | Abre `http://localhost/` em tela cheia no boot do Pi. |

Tudo sobe com `docker compose` e reinicia sozinho após queda de energia.

## Instalação no Raspberry Pi 4

Requisitos: Raspberry Pi OS **64 bits com desktop** (Bookworm), Pi ligado à TV por HDMI e à rede,
de preferência por cabo. Câmeras, Pi e Home Assistant na mesma rede local.

```bash
git clone https://github.com/helioinmidia/blizzard.git ~/blizzard
cd ~/blizzard
./pi/install.sh
sudo reboot
```

O `go2rtc/go2rtc.yaml` (fora do git, porque guarda senhas) é criado a partir de `go2rtc.example.yaml`.
Depois do primeiro boot, gere os streams reais com os scripts da seção seguinte, ou edite o arquivo à mão.

O script instala Docker e Chromium, sobe os containers, cria o autostart do quiosque, desliga o
descanso de tela, ativa o login automático no desktop e define o hostname do Pi como
`view.blizzard.net` (outro nome: `BLIZZARD_HOST=meu.nome ./pi/install.sh`). Depois do reboot a TV
mostra a central, e de qualquer dispositivo da rede ela abre em `http://view.blizzard.net/`.

### Fazer `view.blizzard.net` resolver na rede

Um nome fora de `.local` não é anunciado sozinho; algum DNS precisa apontá-lo para o IP do Pi.
Primeiro fixe o IP do Pi com uma reserva de DHCP no roteador. Depois escolha uma opção:

- **DNS do roteador**: muitos roteadores (UniFi, Mikrotik, OpenWrt) têm "DNS local" ou "Static DNS
  entries". Crie `view.blizzard.net` → IP do Pi.
- **Pi-hole / AdGuard Home**: em *Local DNS records*, o mesmo registro.
- **Você é dono de `blizzard.net`**: crie um registro `A` para `view` com o IP local do Pi
  (ex.: 10.255.200.100) na zona pública. Funciona em casa e ninguém de fora alcança o IP privado.
- **Só o laptop**: adicione `10.255.200.100 view.blizzard.net` ao `/etc/hosts`
  (`C:\Windows\System32\drivers\etc\hosts` no Windows).

O quiosque na TV não depende disso: ele abre `http://localhost/`.

Para atualizar a Blizzard mais tarde:

```bash
cd ~/blizzard && git pull && sudo docker compose up -d --build
```

## Configuração

### 1. Streams das câmeras — `go2rtc/go2rtc.yaml`

Cada câmera vira um stream nomeado. Use **dois** por câmera quando possível: o sub-stream (baixa
resolução) para a grade e o principal para quando a célula é ampliada.

**UniFi Protect, automático (recomendado).** O script `pi/protect-streams.py` consulta a API do Protect
pela rede local, cria os streams RTSPS de cada câmera (Low para a grade, High para ampliar) e grava
tudo no `go2rtc.yaml` e no `blizzard.config.json`. Primeiro gere uma chave de API no Protect:
*Configurações → Control Plane → Integrations → Create API Key*. Depois, no Pi:

```bash
cd ~/blizzard
./pi/protect-streams.py --host 192.168.155.1 --api-key SUA_CHAVE          # só mostra
./pi/protect-streams.py --host 192.168.155.1 --api-key SUA_CHAVE --apply  # grava
sudo docker compose restart go2rtc
```

`--host` é o IP do console UniFi (UDM, UNVR ou Cloud Key). As fontes entram no grupo `casa` com IDs
`unifi-<nome-da-camera>`; coloque-as nos `slots` das visões (ou troque direto na tela). Pode rodar de
novo quando adicionar câmeras: ele substitui só o bloco entre os marcadores `# >>> unifi-protect` e
`# <<< unifi-protect`. Se o seu Protect não tiver chaves de API, use um usuário **local** do UniFi OS
(*Configurações → Admins*, com acesso ao Protect; contas Ubiquiti com 2FA não servem):

```bash
./pi/protect-streams.py --host 192.168.155.1 --user blizzard --password 'SENHA' --enable --apply
```

**UniFi Protect, manual.** No console Protect: Câmera → Configurações → Avançado → *RTSP*: ative os
streams *Low* e *High* e copie as URLs (`rtsps://IP:7441/TOKEN?enableSrtp`). No go2rtc troque o esquema
para `rtspx://` e remova o `?enableSrtp`:

```yaml
casa_garagem: rtspx://192.168.1.1:7441/TOKEN_LOW
casa_garagem_hd: rtspx://192.168.1.1:7441/TOKEN_HIGH
```

**Home Assistant como atalho.** A integração UniFi Protect do HA expõe, por câmera, os interruptores
"High resolution channel" e "Low resolution channel": ligá-los equivale a ativar o RTSP no Protect.
As URLs, porém, continuam vindo do Protect (ou do script acima); o HA não as mostra.

**Intelbras, automático (recomendado).** O script `pi/intelbras-streams.py` consulta o gravador
(DVR/NVR MHDX, NVD ou câmera VIP) pela API HTTP padrão Dahua/Intelbras, lê o nome e o codec de cada
canal e gera os streams RTSP (sub-stream para a grade, principal para ampliar). Use o mesmo usuário e
senha cadastrados no app Intelbras; a porta 37777 do app é do protocolo proprietário e não é usada
aqui (a API usa a 80 e o vídeo a 554).

```bash
./pi/intelbras-streams.py --host 192.168.15.6 --user 'admin@greenforest' --password 'SENHA'          # só mostra
./pi/intelbras-streams.py --host 192.168.15.6 --user 'admin@greenforest' --password 'SENHA' --apply  # grava
sudo docker compose restart go2rtc
```

As fontes entram no grupo `condominio` com IDs `cond-<nome-do-canal>`, substituindo as de exemplo.
O script avisa canais em H.265 (o Chromium do Pi não decodifica; mude para H.264 no gravador) e
canais com sub-stream desligado. Se a API HTTP do gravador estiver bloqueada, `--channels N` gera N
canais numerados sem consultá-la.

**Intelbras, manual.** DVR/NVR e câmeras VIP seguem o padrão Dahua; câmeras Mibo/iM usam `/onvif1`.
Usuário e senha com caracteres especiais precisam de codificação de URL (`@` vira `%40`):

```yaml
cond_portaria: rtsp://admin%40greenforest:SENHA@192.168.15.6:554/cam/realmonitor?channel=1&subtype=1   # sub-stream
cond_portaria_hd: rtsp://admin%40greenforest:SENHA@192.168.15.6:554/cam/realmonitor?channel=1&subtype=0
mibo_sala: rtsp://admin:SENHA@192.168.0.120:554/onvif1
```

Se o condomínio só libera acesso ao gravador por um app ou pela nuvem, peça à administração um
usuário somente-leitura com RTSP habilitado; sem RTSP/ONVIF na rede não há como exibir as câmeras.

**Rede.** O Pi precisa alcançar o gravador diretamente. Se ele está em outra sub-rede (ex.: gravador
em `192.168.15.x` e Pi em `192.168.155.x`), teste do Pi com `curl -m 5 http://192.168.15.6/` e
`nc -vz 192.168.15.6 554`; sem rota entre as redes, é preciso VPN, uma segunda interface de rede no Pi
ligada à rede do condomínio, ou uma regra de roteamento no UniFi.

Depois de editar: `sudo docker compose restart go2rtc`. O painel do go2rtc em `http://view.blizzard.net:1984`
mostra cada stream e permite testá-lo antes de colocar na grade.

### 2. Fontes e visões — `public/config/blizzard.config.json`

Esse arquivo é lido pela página a cada carregamento (não precisa rebuildar). Estrutura:

```jsonc
{
  "go2rtcUrl": "/go2rtc",             // base do go2rtc vista pelo navegador
  "playerMode": "webrtc,mse,hls,mjpeg",// ordem de tentativa do player
  "rotationSeconds": 0,               // rodízio automático entre visões (0 desliga)
  "groups": [ { "id": "casa", "name": "Casa", "kind": "unifi_protect" } ],
  "sources": [
    { "type": "camera", "id": "casa-garagem", "name": "Garagem", "group": "casa",
      "stream": "casa_garagem", "hdStream": "casa_garagem_hd" },
    { "type": "dashboard", "id": "ha-geral", "name": "Visão geral", "group": "ha",
      "url": "http://homeassistant.local:8123/lovelace/0" }
  ],
  "views": [
    { "id": "geral", "name": "Geral", "columns": 3, "rows": 2,
      "slots": ["casa-garagem", "ha-geral", null, null, null, null] }
  ]
}
```

- `kind` aceita `unifi_protect`, `intelbras`, `home_assistant` ou `other` (só muda a etiqueta).
- `slots` lista os IDs das fontes linha a linha; `null` deixa a célula vazia.
- **Tudo é salvo no servidor.** Trocar a fonte de uma célula pelo seletor, ou salvar no editor da
  tecla **C**, grava o arquivo no Pi pela API (`PUT /api/config`, com validação). Cada tela aberta
  (TV, laptop, celular) confere o servidor a cada 10 s e aplica a mudança sozinha. Nada fica no
  navegador. Editar o arquivo à mão ou com os scripts `pi/*-streams.py` tem o mesmo efeito.
- O arquivo é gravado com o usuário dono do repositório (o `pi/install.sh` registra o UID em `.env`),
  então continua editável fora do container.

### 3. Home Assistant dentro do iframe

O HA bloqueia iframes por padrão. Em `configuration.yaml` do HA:

```yaml
http:
  use_x_frame_options: false
```

Para não precisar fazer login na TV, libere o IP do Pi com o provedor `trusted_networks`:

```yaml
homeassistant:
  auth_providers:
    - type: trusted_networks
      trusted_networks:
        - 192.168.1.50/32      # IP do Pi
      allow_bypass_login: true
    - type: homeassistant
```

Sem isso, faça login **dentro do iframe** uma vez (com mouse/teclado no Pi): o Chromium guarda a
sessão. Para esconder cabeçalho e barra lateral do HA, instale o
[kiosk-mode](https://github.com/NemesisRE/kiosk-mode) via HACS e acrescente `?kiosk` à URL do painel.

## Uso na TV

| Tecla | Ação |
| --- | --- |
| `1`–`9` | Troca de visão |
| `R` | Liga/desliga o rodízio automático |
| `F` | Tela cheia do navegador |
| `S` | Painel lateral com todas as fontes (clique amplia) |
| `C` | Editor de configuração |
| `Esc` | Volta da célula ampliada |

Com o mouse sobre uma célula aparece um seletor para trocar a fonte ali mesmo e um botão para ampliar.
Após 15 s sem mouse/teclado a interface some e fica só o vídeo.

## Desempenho no Pi 4

O Chromium do Pi decodifica vídeo por software. Regras práticas:

- Na grade, use sempre o sub-stream das câmeras (≈640×360, ≤15 fps). 4 a 6 células rodam bem; 9 é o limite.
- H.264 é o codec seguro. H.265/HEVC não toca no Chromium do Pi; mude a câmera para H.264 ou deixe
  o go2rtc transcodificar apenas esse stream (`ffmpeg:...#video=h264`), com custo de CPU.
- Prefira cabo de rede. Wi-Fi funciona, mas várias câmeras simultâneas sofrem com perda de pacotes.
- Um dissipador ou cooler evita *throttling* com muitas células.

## Desenvolvimento

```bash
npm install
python3 server/config-api.py &                 # API de configuração em http://127.0.0.1:8787
npm run dev            # http://localhost:5173, /go2rtc → http://127.0.0.1:1984, /api → :8787
GO2RTC_URL=http://view.blizzard.net:1984 CONFIG_API_URL=http://view.blizzard.net:8787 npm run dev   # usa o Pi
npm run build && npm run lint
```

Estrutura:

```
src/lib/config.ts        tipos, validação, leitura e gravação (API) do blizzard.config.json
server/config-api.py     API de configuração (GET/PUT /api/config) que grava o arquivo no Pi
src/lib/player.ts        <blizzard-video>, extensão do player oficial do go2rtc (src/vendor)
src/components/          TopBar, Sidebar, Wall, Tile, VideoTile, DashboardTile, SettingsDialog
go2rtc/go2rtc.example.yaml  modelo dos streams (o real, go2rtc.yaml, fica fora do git)
public/config/           configuração de fontes e visões (montada como volume no container)
pi/                      instalação, quiosque e descoberta de câmeras (protect-streams.py, intelbras-streams.py)
```

## Solução de problemas

- **"Sem sinal" numa célula** — abra `http://view.blizzard.net:1984`, clique no stream e veja o erro do go2rtc
  (senha errada, câmera fora, codec H.265). O nome em `stream` precisa existir no `go2rtc.yaml`;
  o painel lateral (`S`) marca com um triângulo as fontes cujo stream não existe.
- **Vídeo fica em "Conectando…" e cai para MSE** — WebRTC não negociou. Descomente `webrtc.candidates`
  no `go2rtc.yaml` com o IP do Pi e reinicie o go2rtc.
- **Célula fica em "go2rtc inacessível" mas `http://view.blizzard.net:1984` abre** — o go2rtc recusa WebSocket
  quando o `Origin` do navegador não bate com o `Host` que chega a ele. O nginx deste projeto já remove o
  `Origin`; se você colocar outro proxy na frente, faça o mesmo ou defina `api.origin: "*"` no `go2rtc.yaml`.
- **Painel do HA em branco** — falta `use_x_frame_options: false` no HA, ou a URL usa `https` com
  certificado que o Chromium rejeita. Teste a URL direto no navegador do Pi.
- **Tela escurece após alguns minutos** — rode `sudo raspi-config` → Display Options → Screen Blanking → No.

O player em `src/vendor/video-rtc.js` é do projeto go2rtc (licença MIT, em `src/vendor/LICENSE-go2rtc`).

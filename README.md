# Blizzard · Central de Monitoramento

Video wall para TV que reúne, numa única tela:

- **Câmeras da casa** — UniFi Protect (UDM / UNVR / Cloud Key)
- **Câmeras do condomínio** — DVR/NVR e câmeras Intelbras
- **Home Assistant** — cartões de resumo ao vivo (temperaturas, persianas, movimento, portas…) ou
  qualquer dashboard embutido

Roda inteiro num **Raspberry Pi 4** ligado à TV por HDMI. Nada depende de laptop ou celular: o Pi
serve a página, converte os streams das câmeras para o navegador e abre o Chromium em modo quiosque no boot.

## Como funciona

```
Câmeras UniFi (RTSPS) ─┐
Câmeras Intelbras (RTSP) ┼─▶ go2rtc ─▶ WebRTC / MSE ─▶ Chromium (quiosque) ─▶ TV
                                        ▲
Home Assistant ─▶ ha-bridge (SSE) ─▶ Blizzard web (nginx + React)
```

| Peça | Função |
| --- | --- |
| [go2rtc](https://github.com/AlexxIT/go2rtc) | Recebe RTSP/RTSPS das câmeras e entrega ao navegador via WebRTC (ou MSE/HLS como fallback), sem transcodificar. |
| Blizzard web | Aplicação React (este repositório) servida por nginx, que também faz proxy de `/go2rtc` para o go2rtc de `/api` para a API de configuração e de `/ha` para a ponte do Home Assistant. |
| API de configuração | `server/config-api.py` (Python, sem dependências): lê e grava `public/config/blizzard.config.json`. Toda alteração feita na tela é salva aqui, nunca no navegador. |
| ha-bridge | Serviço Node sem dependências (`ha-bridge/server.mjs`). Guarda o token do Home Assistant no Pi e envia ao navegador, em tempo real e só para leitura, os estados das entidades usadas nos cartões. |
| Chromium em quiosque | Abre `http://localhost/` em tela cheia no boot do Pi. |

Tudo sobe com `docker compose` e reinicia sozinho após queda de energia.

## Instalação no Raspberry Pi 4

Requisitos: Raspberry Pi OS **64 bits com desktop** (Bookworm), Pi ligado à TV por HDMI e à rede,
de preferência por cabo. Câmeras, Pi e Home Assistant na mesma rede local.

```bash
git clone https://github.com/helioinmidia/blizzard.git ~/blizzard
cd ~/blizzard
cp .env.example .env && nano .env                # URL e token do Home Assistant (cartões de resumo)
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

**Intelbras, automático (recomendado).** O script `pi/intelbras-streams.py` gera os streams RTSP do
gravador (DVR/NVR MHDX, NVD) ou câmera VIP: sub-stream para a grade, principal para ampliar. Ele sonda
cada canal por RTSP e resolve sozinho o que o Pi não toca: sub-stream em H.265 passa pelo template
`h264/pi` (~20% de um núcleo enquanto estiver na tela) e principal em H.265 não é usado ao ampliar.
A porta 37777 do app é do protocolo proprietário e não é usada aqui (o vídeo usa a 554). A senha nunca vai
na linha de comando: o script pergunta (ou lê `INTELBRAS_PASSWORD`).

*Gravador em outra rede (ex.: a do condomínio), com a porta RTSP encaminhada no modem de lá:*

```bash
./pi/intelbras-streams.py --host ENDERECO_PUBLICO --rtsp-port PORTA_EXTERNA --user blizzard --channels 16 --check
./pi/intelbras-streams.py --host ENDERECO_PUBLICO --rtsp-port PORTA_EXTERNA --user blizzard --channels 16 --apply
docker compose restart go2rtc
```

`--check` só testa e diz o que está errado (nome não resolve, porta fechada, porta que não fala RTSP,
senha recusada, codec de cada canal). `--channels N` é o número de canais do gravador, porque a API HTTP
(que daria os nomes) não fica exposta; canais que não responderem ficam de fora e `--only 1,2,5` escolhe
alguns. Depois dê os nomes reais em `name` no `blizzard.config.json` (os `id` não mudam).

O que pedir a quem administra o gravador e o modem:

1. **Um usuário só para a central** (ex.: `blizzard`), no grupo de usuários comuns, com permissão apenas de
   *visualização ao vivo* dos canais desejados. Nunca o `admin`: essa senha fica no `go2rtc.yaml` do Pi e
   qualquer um na sua rede local consegue ver os streams servidos pelo go2rtc.
2. **Encaminhamento de porta só do RTSP**: porta externa alta e incomum (ex.: 5554) → IP do gravador, porta
   554, TCP. Não encaminhe a 80 (painel web) nem a 37777.
3. **Restringir a origem** ao seu IP público, se o modem permitir (`curl -s ifconfig.me` no Pi mostra qual é).
   RTSP não é criptografado: usuário só de visualização + origem restrita é o que mantém isso aceitável.
4. **IP fixo para o gravador** na rede dele (reserva de DHCP) e, se o IP público de lá mudar, um DDNS
   (o próprio gravador oferece o DDNS Intelbras em Rede → DDNS).
5. No gravador, **sub-stream em H.264**, resolução baixa (CIF/D1) e 10–15 fps: custo zero de CPU no Pi e
   pouca banda no link do condomínio (cada célula na tela é um stream contínuo pela internet).

*Gravador na mesma rede do Pi:* a API HTTP (porta 80) dá os nomes dos canais.

```bash
./pi/intelbras-streams.py --host 192.168.15.6 --user blizzard --apply
docker compose restart go2rtc
```

As fontes entram no grupo `condominio` com IDs `cond-<nome-do-canal>`, substituindo as de exemplo, e, se a
visão `condominio` não existir ou estiver vazia, já são colocadas nela (a grade se ajusta à quantidade).

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

Esse arquivo fica fora do git (é a configuração viva, gravada pela tela). O instalador e a API o criam a
partir de `blizzard.config.example.json` quando não existe; `git pull` nunca o toca.

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

- `type` da fonte: `camera` (stream do go2rtc), `ha` (cartões do Home Assistant, seção 3) ou `dashboard`
  (qualquer página em iframe).
- `quality` (opcional): `"hd"` (padrão) usa o `hdStream` de cada câmera também na grade; `"auto"` usa o
  sub-stream na grade e o HD só ao ampliar, poupando o Pi quando há muitas células.
- `temperature` (opcional) mostra a temperatura atual no cabeçalho, ao lado do relógio, lida do Home
  Assistant pela ponte: `"temperature": { "entity": "weather.casa" }`. Aceita `weather.*` (temperatura,
  ícone e condição), `sensor.*` (valor com a unidade) ou `climate.*` (temperatura atual); `label` troca o
  texto abaixo do valor e `bridgeUrl` a ponte (padrão `/ha`). A ponte assina essa entidade sozinha.
- `kind` aceita `unifi_protect`, `intelbras`, `home_assistant` ou `other` (só muda a etiqueta).
- `slots` lista os IDs das fontes linha a linha; `null` deixa a célula vazia.
- `spans` (opcional) aumenta células: `"spans": { "0": { "cols": 2, "rows": 2 } }` faz o primeiro slot ocupar
  2×2, por exemplo um painel do Home Assistant grande com cartões ao lado. Os slots seguintes preenchem o
  que sobra da grade.
- **Tudo é salvo no servidor.** Trocar a fonte de uma célula pelo seletor, ou salvar no editor da
  tecla **C**, grava o arquivo no Pi pela API (`PUT /api/config`, com validação). Cada tela aberta
  (TV, laptop, celular) confere o servidor a cada 10 s e aplica a mudança sozinha. Nada fica no
  navegador. Editar o arquivo à mão ou com os scripts `pi/*-streams.py` tem o mesmo efeito.
- O arquivo é gravado com o usuário dono do repositório (o `pi/install.sh` registra o UID em `.env`),
  então continua editável fora do container.

### 3. Home Assistant — cartões de resumo

Uma fonte `"type": "ha"` desenha cartões nativos com os estados das entidades, atualizados em tempo real.
Não precisa de login na TV nem de mudança no Home Assistant, e pesa muito menos no Pi do que um dashboard
em iframe.

1. No HA, crie um token: *Perfil → Segurança → Tokens de acesso de longa duração → Criar token*.
2. No Pi, `cp .env.example .env` e preencha `HA_URL` (como o Pi enxerga o HA) e `HA_TOKEN`.
   O `.env` fica fora do git.
3. Declare a fonte e coloque o `id` dela nos `slots` de uma visão:

```jsonc
{ "type": "ha", "id": "ha-casa", "name": "Casa agora", "group": "ha",
  "scale": 1,                        // opcional: 1.2 aumenta o texto, 0.9 diminui
  "cards": [
    { "title": "Temperatura", "entities": [
        { "entity": "sensor.term_sala_temperature", "name": "Sala" },
        "sensor.term_externo_temperature"            // sem "name": usa o nome do HA
    ] },
    { "title": "Persianas", "entities": [ { "entity": "cover.persiana_suite", "name": "Suíte" } ] },
    { "title": "Movimento", "entities": [ { "entity": "binary_sensor.sensor_sala", "name": "Sala" } ] }
  ] }
```

4. `sudo docker compose up -d --build`. Mudanças posteriores na lista de entidades não pedem restart:
   a ponte relê o arquivo sozinha.

Cada cartão tem um `kind` (o padrão é `list`):

| `kind` | O que mostra |
| --- | --- |
| `list` | Estado atual de cada entidade (tabela abaixo) |
| `graph` | Linhas com o histórico das últimas `hours` horas (padrão 24, até 72), até 5 entidades da mesma unidade. Legenda com o valor atual; passar o mouse mostra os valores naquele instante |
| `bars` | Variação por hora nas últimas 48 h de um medidor acumulado, ex.: kWh consumidos em cada hora, com o total de hoje |
| `weather` | Condição atual e previsão diária de uma entidade `weather.*` |

```jsonc
{ "title": "Temperatura · 24 h", "kind": "graph", "hours": 24, "entities": [
    { "entity": "sensor.term_externo_temperature", "name": "Externo" },
    { "entity": "sensor.term_sala_temperature", "name": "Sala" } ] },
{ "title": "Consumo por hora", "kind": "bars", "entities": [ { "entity": "sensor.energia_ano", "name": "Consumo" } ] },
{ "title": "Tempo", "kind": "weather", "entities": ["weather.home"] }
```

Com isso uma fonte `ha` grande (veja `spans` acima) faz o papel de um dashboard inteiro, servido pelo próprio
Pi: não precisa de iframe, de login na TV nem de mudança no Home Assistant. O histórico vem da ponte em
médias de 5 minutos (`/ha/history`) e as barras das estatísticas do HA (`/ha/statistics`).

Num cartão `list`, como cada entidade aparece depende do domínio e do `device_class` dela:

| Entidade | Exibição |
| --- | --- |
| `sensor` numérico | Número grande com unidade; o cabeçalho do cartão mostra a faixa mín – máx |
| `cover` | Aberta / Fechada / Abrindo / Fechando, com a posição quando parcial; cabeçalho "2 de 4 abertas" |
| `binary_sensor` de movimento/presença | **Movimento** em destaque, ou "Livre · há 12 min"; cabeçalho "2 com movimento" |
| `binary_sensor` de porta/janela | Aberta (em vermelho, com há quanto tempo) / Fechada |
| `binary_sensor` de fumaça, gás, vazamento, problema | Alerta (vermelho) / Normal |
| `climate` | Modo atual e temperatura medida |
| `person`, `lock`, `alarm_control_panel`, `light`, `switch` | Em casa/Fora, Trancada/Destrancada, Armado/Desarmado, Ligado/Desligado |

Cartões só com sensores numéricos viram uma grade de números; listas com mais de 6 entidades ocupam a
largura toda em duas colunas. O texto acompanha o tamanho da célula, então a mesma fonte serve na grade e
ampliada.

**Segurança.** O token nunca chega ao navegador: fica no container `ha-bridge`, que escuta apenas em
`127.0.0.1:8099` e é publicado pelo nginx em `/ha/`. A ponte só lê, e só expõe as entidades citadas no
`blizzard.config.json` do servidor; ela relê o arquivo sozinha quando a tela salva uma alteração. Quem estiver na rede local consegue ver
esses estados, assim como já consegue ver as câmeras.

### 4. Home Assistant dentro de um iframe (opcional)

Para embutir um dashboard inteiro do HA use uma fonte `"type": "dashboard"` com a URL dele. O HA bloqueia
iframes por padrão. Em `configuration.yaml` do HA:

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

## Interface

Visual "Glacier": fundo azul-noite, painel lateral de vidro fosco com visões e fontes, cabeçalho com o
nome da visão e relógio grande, células arredondadas com chip de estado (Ao vivo, Sem sinal, Painel).
O grid de exemplo prevê 12 câmeras: **Geral** 4×3 (4 da casa + 8 do condomínio), **Casa** 2×2,
**Condomínio** 4×2. A fonte Manrope vem do Google Fonts; sem internet a interface usa a fonte do sistema.
O painel lateral abre por padrão e some com a tecla `S`; após 15 s sem mouse só o cursor é escondido.

Ajustes **por tela**, na URL (a configuração é compartilhada entre TV e laptop; estes não):

| Parâmetro | Efeito |
| --- | --- |
| `?sidebar=0` | começa sem o painel lateral: numa TV, as células ficam ~17 % maiores |
| `?scale=1.15` | amplia toda a interface (0.75 a 2) para leitura à distância |
| `?view=casa` | abre direto nessa visão |

O quiosque do Pi usa `http://localhost/?sidebar=0&scale=1.15&view=casa` (variável `BLIZZARD_URL` em `pi/kiosk.sh`).
Numa TV de 42" Full HD, a visão Geral 4×3 sem painel dá células de cerca de 22 × 12 cm; com 3×3, 29 × 16 cm.

## Uso na TV

| Tecla | Ação |
| --- | --- |
| `1`–`9` | Troca de visão |
| `?view=<id>` na URL | Abre direto numa visão, ex.: `http://view.blizzard.net/?view=home-assistant` |
| `R` | Liga/desliga o rodízio automático |
| `F` | Tela cheia do navegador |
| `S` | Painel lateral com todas as fontes (clique amplia) |
| `C` | Editor de configuração |
| `Esc` | Volta da célula ampliada |

Com o mouse sobre uma célula aparece um seletor para trocar a fonte ali mesmo e um botão para ampliar.
Após 15 s sem mouse/teclado a interface some e fica só o vídeo.

## Desempenho no Pi 4

O Chromium do Pi decodifica vídeo por software. Regras práticas:

- Com `quality: "hd"` (padrão) a grade decodifica o stream principal de cada câmera: 4 câmeras 1080p é o
  limite confortável do Pi 4. Acima disso, use `"auto"`: sub-stream na grade (≈640×360, ≤15 fps) e HD só ao
  ampliar. Em sub-stream, 4 a 6 células rodam bem; 9 é o limite.
- H.264 é o codec seguro. **H.265/HEVC não toca no Chromium do Pi** (a célula mostra "codecs not matched:
  video:H265"). É o caso do UniFi Protect com *Enhanced encoding* ligado. Duas saídas:
  - **Na câmera (melhor):** Protect → câmera → Configurações → Gravação → *Encoding* **Standard (H.264)**.
    Custo zero no Pi e o stream High volta a funcionar ao ampliar; as gravações ocupam mais disco.
  - **No Pi:** `./pi/protect-streams.py ... --h264 --apply`. O stream Low é convertido para H.264 pelo
    go2rtc (template `h264/pi` do `go2rtc.yaml`: 640×360 a 15 fps, ~20% de um núcleo por câmera; 4 câmeras
    deixam o Pi 4 em ~70% de CPU, sem *throttling*). O High (4 MP em H.265) fica sem uso: o Pi não consegue
    convertê-lo em tempo real, então a célula ampliada mostra o mesmo stream da grade. O encoder por
    hardware do Pi não é usado porque só envia SPS/PPS no primeiro quadro, e quem conecta depois recebe
    imagem corrompida.
- Prefira cabo de rede. Wi-Fi funciona, mas várias câmeras simultâneas sofrem com perda de pacotes.
- Um dissipador ou cooler evita *throttling* com muitas células.

## Desenvolvimento

```bash
npm install
python3 server/config-api.py &                 # API de configuração em http://127.0.0.1:8787
npm run dev            # http://localhost:5173, /go2rtc → http://127.0.0.1:1984, /api → :8787
GO2RTC_URL=http://view.blizzard.net:1984 CONFIG_API_URL=http://view.blizzard.net:8787 npm run dev   # usa o Pi
# cartões do Home Assistant em desenvolvimento: rode a ponte ao lado (/ha → http://127.0.0.1:8099)
HA_URL=http://homeassistant.local:8123 HA_TOKEN=... BLIZZARD_CONFIG=public/config/blizzard.config.json node ha-bridge/server.mjs
npm run build && npm run lint
```

Estrutura:

```
src/lib/config.ts        tipos, validação, leitura e gravação (API) do blizzard.config.json
server/config-api.py     API de configuração (GET/PUT /api/config) que grava o arquivo no Pi
src/lib/player.ts        <blizzard-video>, extensão do player oficial do go2rtc (src/vendor)
src/lib/ha.ts            conexão SSE com a ponte e tradução dos estados do Home Assistant
src/components/          TopBar, Sidebar, Wall, Tile, VideoTile, HaTile, DashboardTile, SettingsDialog
ha-bridge/               ponte do Home Assistant (token no servidor, estados por SSE)
go2rtc/go2rtc.example.yaml  modelo dos streams (o real, go2rtc.yaml, fica fora do git)
public/config/           blizzard.config.example.json (modelo); o real, blizzard.config.json, fica fora do git
pi/                      instalação, quiosque e descoberta de câmeras (protect-streams.py, intelbras-streams.py)
```

## Solução de problemas

- **"Sem sinal" numa célula** — abra `http://view.blizzard.net:1984`, clique no stream e veja o erro do go2rtc
  (senha errada, câmera fora, codec H.265). O nome em `stream` precisa existir no `go2rtc.yaml`;
  o painel lateral (`S`) marca com um triângulo as fontes cujo stream não existe.
- **Célula sem vídeo** se recupera sozinha: após 30 s sem imagem ela refaz a conexão do zero.
- **Vídeo fica em "Conectando…" e cai para MSE** — WebRTC não negociou. Descomente `webrtc.candidates`
  no `go2rtc.yaml` com o IP do Pi e reinicie o go2rtc.
- **Célula fica em "go2rtc inacessível" mas `http://view.blizzard.net:1984` abre** — o go2rtc recusa WebSocket
  quando o `Origin` do navegador não bate com o `Host` que chega a ele. O nginx deste projeto já remove o
  `Origin`; se você colocar outro proxy na frente, faça o mesmo ou defina `api.origin: "*"` no `go2rtc.yaml`.
- **Cartão do HA em "Ponte do Home Assistant inacessível" ou "Home Assistant fora do ar"** — veja
  `sudo docker logs blizzard-ha-bridge`: falta o `.env`, o token foi recusado ou o Pi não alcança `HA_URL`.
  `curl http://localhost/ha/health` mostra se a ponte está conectada e quantas entidades acompanha.
  "Sem dados" numa linha = `entity_id` errado; "Indisponível" = o próprio HA está sem o dispositivo.
- **Painel do HA (iframe) em branco** — falta `use_x_frame_options: false` no HA, ou a URL usa `https` com
  certificado que o Chromium rejeita. Teste a URL direto no navegador do Pi.
- **Tela escurece após alguns minutos** — rode `sudo raspi-config` → Display Options → Screen Blanking → No.

O player em `src/vendor/video-rtc.js` é do projeto go2rtc (licença MIT, em `src/vendor/LICENSE-go2rtc`).

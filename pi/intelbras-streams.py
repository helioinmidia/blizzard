#!/usr/bin/env python3
"""
Descobre os canais de um gravador (DVR/NVR) ou câmera Intelbras/Dahua e gera os streams RTSP
para o go2rtc e a Blizzard. Roda no Pi; só usa a biblioteca padrão.

As URLs geradas seguem o padrão:
  rtsp://USUARIO:SENHA@HOST:PORTA/cam/realmonitor?channel=N&subtype=1   (sub-stream, grade)
  rtsp://USUARIO:SENHA@HOST:PORTA/cam/realmonitor?channel=N&subtype=0   (stream principal, ampliado)

A senha nunca vai na linha de comando (ficaria no histórico do shell): o script pergunta, ou lê a
variável INTELBRAS_PASSWORD.

Gravador em outra rede, com a porta RTSP encaminhada no modem/roteador de lá (só o RTSP, sem a API HTTP):
  ./pi/intelbras-streams.py --host meu-ddns.exemplo.com --rtsp-port 5554 --user blizzard --channels 8 --check
  ./pi/intelbras-streams.py --host meu-ddns.exemplo.com --rtsp-port 5554 --user blizzard --channels 8 --apply
      --check  só testa: a porta abre? usuário/senha passam? qual o codec de cada canal?
      --only 1,2,5   usa só esses canais

Gravador na mesma rede (a API HTTP na porta 80 dá os nomes dos canais):
  ./pi/intelbras-streams.py --host 192.168.15.6 --user blizzard --apply

Cada canal é sondado por RTSP (DESCRIBE). Se o sub-stream estiver em H.265, que o Chromium do Pi não toca,
o stream passa pelo template "h264/pi" do go2rtc.yaml (--h264 auto, o padrão). Melhor ainda é deixar o
sub-stream do gravador em H.264: custo zero no Pi.

Sem --apply, apenas imprime. Com --apply, grava:
  - go2rtc/go2rtc.yaml               entre "# >>> intelbras" e "# <<< intelbras" (contém a senha: chmod 600)
  - public/config/blizzard.config.json  fontes "cond-<canal>" no grupo (--group) e, se a visão (--view)
                                     não existir ou estiver vazia, as câmeras já entram nela
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blizzard_common import CONFIG_PATH, GO2RTC_PATH, apply_config, apply_go2rtc, build_outputs, fill_view  # noqa: E402

TAG = "intelbras"
SCRIPT = "pi/intelbras-streams.py"


class DahuaClient:
    def __init__(self, host: str, http_port: int, user: str, password: str, timeout: int = 15):
        self.base = f"http://{host}:{http_port}"
        self.timeout = timeout
        mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        mgr.add_password(None, self.base, user, password)
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPDigestAuthHandler(mgr), urllib.request.HTTPBasicAuthHandler(mgr)
        )

    def get(self, path: str) -> str:
        try:
            with self.opener.open(self.base + path, timeout=self.timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            if err.code == 401:
                raise SystemExit("O gravador recusou usuário/senha (HTTP 401).") from None
            raise SystemExit(f"GET {path} -> HTTP {err.code}: {err.read()[:200]!r}") from None
        except urllib.error.URLError as err:
            raise SystemExit(f"Não foi possível conectar em {self.base}: {err.reason}") from None

    def config(self, name: str) -> dict:
        """Converte 'table.X[0].Y=valor' em {'X[0].Y': 'valor'}."""
        out = {}
        for line in self.get(f"/cgi-bin/configManager.cgi?action=getConfig&name={name}").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                out[key.strip().removeprefix("table.")] = value.strip()
        return out

    def device_type(self) -> str:
        text = self.get("/cgi-bin/magicBox.cgi?action=getDeviceType")
        return text.split("=", 1)[1].strip() if "=" in text else text.strip()


def discover(client: DahuaClient):
    """Retorna [{index, name, main_codec, sub_codec, sub_enabled}] a partir da API do gravador."""
    titles = client.config("ChannelTitle")
    channels = {}
    for key, value in titles.items():
        m = re.fullmatch(r"ChannelTitle\[(\d+)\]\.Name", key)
        if m:
            channels[int(m.group(1))] = {"index": int(m.group(1)), "name": value or f"Canal {int(m.group(1)) + 1}"}
    if not channels:
        raise SystemExit("A API respondeu, mas não listou canais (ChannelTitle vazio). Use --channels N.")

    encode = {}
    try:
        encode = client.config("Encode")
    except SystemExit as err:
        print(f"  aviso: não li a configuração de codec ({err}); seguindo sem ela", file=sys.stderr)
    for idx, ch in channels.items():
        ch["main_codec"] = encode.get(f"Encode[{idx}].MainFormat[0].Video.Compression")
        ch["sub_codec"] = encode.get(f"Encode[{idx}].ExtraFormat[0].Video.Compression")
        ch["sub_enabled"] = encode.get(f"Encode[{idx}].ExtraFormat[0].VideoEnable", "true").lower() != "false"
        ch["sub_res"] = encode.get(f"Encode[{idx}].ExtraFormat[0].Video.resolution")
    return [channels[i] for i in sorted(channels)]


def _rtsp_request(sock, url: str, cseq: int, authorization: str | None):
    lines = [f"DESCRIBE {url} RTSP/1.0", f"CSeq: {cseq}", "Accept: application/sdp", "User-Agent: blizzard-intelbras-streams"]
    if authorization:
        lines.append(f"Authorization: {authorization}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    text = head.decode("utf-8", errors="replace")
    status = int(text.split(" ", 2)[1]) if text.startswith("RTSP/") else 0
    headers = {}
    for line in text.split("\r\n")[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            headers.setdefault(key.strip().lower(), []).append(value.strip())
    length = int(headers.get("content-length", ["0"])[0] or 0)
    while len(body) < length:
        chunk = sock.recv(4096)
        if not chunk:
            break
        body += chunk
    return status, headers, body.decode("utf-8", errors="replace")


def _rtsp_authorization(challenges, user: str, password: str, url: str):
    digest = next((c for c in challenges if c.lower().startswith("digest")), None)
    if digest:
        fields = dict(re.findall(r'(\w+)="?([^",]+)"?', digest[6:]))
        realm, nonce = fields.get("realm", ""), fields.get("nonce", "")
        md5 = lambda text: hashlib.md5(text.encode()).hexdigest()  # noqa: E731
        ha1, ha2 = md5(f"{user}:{realm}:{password}"), md5(f"DESCRIBE:{url}")
        return f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{url}", response="{md5(f"{ha1}:{nonce}:{ha2}")}"'
    if any(c.lower().startswith("basic") for c in challenges):
        return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
    return None


def probe_rtsp(host: str, port: int, user: str, password: str, channel: int, subtype: int, timeout: float = 8.0) -> dict:
    """DESCRIBE no stream do canal: confirma porta, usuário/senha e devolve o codec de vídeo anunciado no SDP."""
    url = f"rtsp://{host}:{port}/cam/realmonitor?channel={channel}&subtype={subtype}"
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            status, headers, body = _rtsp_request(sock, url, 1, None)
            if status == 401:
                authorization = _rtsp_authorization(headers.get("www-authenticate", []), user, password, url)
                if authorization is None:
                    return {"ok": False, "error": "o gravador pediu um tipo de autenticação desconhecido"}
                status, headers, body = _rtsp_request(sock, url, 2, authorization)
    except socket.gaierror:
        return {"ok": False, "fatal": True, "error": f"o nome {host} não resolve (DNS/DDNS)"}
    except (TimeoutError, socket.timeout):
        return {"ok": False, "fatal": True, "error": f"sem resposta em {host}:{port} (encaminhamento de porta? firewall? IP de origem liberado?)"}
    except ConnectionRefusedError:
        return {"ok": False, "fatal": True, "error": f"{host}:{port} recusou a conexão (porta fechada ou encaminhada para o lugar errado)"}
    except OSError as err:
        return {"ok": False, "fatal": True, "error": f"falha de rede: {err}"}
    if status == 401:
        return {"ok": False, "fatal": True, "error": "usuário ou senha recusados (ou usuário sem permissão de visualização ao vivo)"}
    if status == 0:
        return {"ok": False, "fatal": True, "error": "quem respondeu nessa porta não fala RTSP (porta encaminhada para outro serviço?)"}
    if status != 200:
        return {"ok": False, "error": f"RTSP {status} (canal inexistente ou sem esse stream)"}
    codecs = re.findall(r"^a=rtpmap:\d+ ([A-Za-z0-9.-]+)/", body, re.M)
    video = next((c.upper() for c in codecs if c.upper() in ("H264", "H265", "HEVC", "JPEG", "MP4V-ES")), None)
    return {"ok": True, "codec": {"HEVC": "H265"}.get(video, video)}


def rtsp_url(host: str, port: int, user: str, password: str, channel: int, subtype: int) -> str:
    cred = f"{urllib.parse.quote(user, safe='')}:{urllib.parse.quote(password, safe='')}"
    return f"rtsp://{cred}@{host}:{port}/cam/realmonitor?channel={channel}&subtype={subtype}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", required=True, help="IP ou nome (DDNS) do gravador; com encaminhamento de porta, o endereço público")
    parser.add_argument("--user", default=os.environ.get("INTELBRAS_USER", "admin"))
    parser.add_argument("--password", default=os.environ.get("INTELBRAS_PASSWORD"), help=argparse.SUPPRESS)
    parser.add_argument("--http-port", type=int, default=80, help="porta HTTP da API (padrão 80)")
    parser.add_argument("--rtsp-port", type=int, default=554, help="porta RTSP; com encaminhamento, a porta EXTERNA (padrão 554)")
    parser.add_argument("--channels", type=int, help="não consulta a API: gera N canais numerados")
    parser.add_argument("--group", default="condominio", help="grupo da Blizzard (padrão: condominio)")
    parser.add_argument("--group-name", default="Condomínio")
    parser.add_argument("--prefix", default="cond", help="prefixo dos streams no go2rtc (padrão: cond)")
    parser.add_argument("--only", help="usa só estes canais, ex.: 1,2,5")
    parser.add_argument("--check", action="store_true", help="só testa a conexão RTSP e o codec de cada canal; não gera nada")
    parser.add_argument("--no-probe", action="store_true", help="não sonda os canais por RTSP (gera as URLs às cegas)")
    parser.add_argument("--h264", choices=["auto", "always", "never"], default="auto",
                        help="converter para H.264 no Pi: auto = só canais que anunciam H.265 (padrão)")
    parser.add_argument("--view", default=None, help="visão que recebe as câmeras se estiver vazia (padrão: o id do grupo)")
    parser.add_argument("--apply", action="store_true", help="grava go2rtc.yaml e blizzard.config.json")
    parser.add_argument("--go2rtc", default=None)
    parser.add_argument("--config", default=None)
    args = parser.parse_args()
    if not args.password:
        if not sys.stdin.isatty():
            parser.error("defina a variável INTELBRAS_PASSWORD (sem terminal para perguntar a senha)")
        args.password = getpass.getpass(f"Senha de {args.user} no gravador: ")
    only = {int(n) for n in re.findall(r"\d+", args.only or "")}

    if args.channels:
        channels = [{"index": i, "name": f"Canal {i + 1}", "main_codec": None, "sub_codec": None, "sub_enabled": True} for i in range(args.channels)]
    else:
        client = DahuaClient(args.host, args.http_port, args.user, args.password)
        print(f"Consultando {args.host}…", file=sys.stderr)
        try:
            print(f"Equipamento: {client.device_type()}", file=sys.stderr)
        except SystemExit as err:
            print(f"  aviso: {err}", file=sys.stderr)
        channels = discover(client)

    if only:
        channels = [ch for ch in channels if ch["index"] + 1 in only]

    cameras = []
    failures = 0
    print(f"\n{len(channels)} canal(is):", file=sys.stderr)
    for ch in channels:
        n = ch["index"] + 1
        notes = []
        sub = 1 if ch.get("sub_enabled", True) else 0
        probed = {} if args.no_probe else probe_rtsp(args.host, args.rtsp_port, args.user, args.password, n, sub)
        if probed.get("fatal"):
            # Porta, DNS ou senha: o problema é o mesmo para todos os canais, não adianta insistir.
            raise SystemExit(f"\nRTSP: {probed['error']}")
        if probed and not probed["ok"]:
            failures += 1
            notes.append(f"RTSP: {probed['error']}")
        codec = probed.get("codec") or ("H265" if (ch.get("sub_codec") or "").upper().startswith("H.265") else None)
        if probed.get("ok"):
            notes.append(f"RTSP ok, {codec or 'codec não anunciado'}")
        if ch.get("main_codec"):
            notes.append(f"principal {ch['main_codec']}")
        if ch.get("sub_codec"):
            notes.append(f"sub {ch['sub_codec']}" + (f" {ch['sub_res']}" if ch.get("sub_res") else ""))
        if not ch.get("sub_enabled", True):
            notes.append("SUB-STREAM DESLIGADO: ligue no gravador (Codificação > Stream extra) para aliviar o Pi")
        transcode = args.h264 == "always" or (args.h264 == "auto" and codec == "H265")
        if transcode:
            notes.append("H.265 → convertido para H.264 no Pi (~20% de um núcleo enquanto estiver na tela)")
        elif codec == "H265":
            notes.append("H.265 não toca no Chromium do Pi: mude o canal para H.264 no gravador ou use --h264 auto")
        # O stream principal só serve para ampliar se o Pi conseguir tocá-lo: em gravadores Intelbras é comum
        # sub-stream em H.264 e principal em H.265 (e converter o principal em tempo real o Pi 4 não aguenta).
        use_main = sub == 1 and not transcode
        if use_main and probed.get("ok"):
            main = probe_rtsp(args.host, args.rtsp_port, args.user, args.password, n, 0)
            main_codec = main.get("codec") or ("H265" if (ch.get("main_codec") or "").upper().startswith("H.265") else None)
            if not main.get("ok") or main_codec == "H265":
                use_main = False
                notes.append("principal em H.265: ao ampliar, a célula usa o mesmo sub-stream" if main.get("ok") else "stream principal não respondeu")
        print(f"  {n:>2}. {ch['name']}" + (f"  ({'; '.join(notes)})" if notes else ""), file=sys.stderr)
        if probed and not probed["ok"]:
            continue
        cameras.append({
            "name": ch["name"],
            "low": rtsp_url(args.host, args.rtsp_port, args.user, args.password, n, sub),
            "high": rtsp_url(args.host, args.rtsp_port, args.user, args.password, n, 0) if use_main else None,
            "h264": transcode,
        })

    if args.check:
        print(f"\n{len(cameras)} canal(is) respondendo, {failures} com erro. Nada foi gravado (--check).", file=sys.stderr)
        return
    if not cameras:
        raise SystemExit("\nNenhum canal respondeu por RTSP; nada a gravar.")

    block, sources = build_outputs(cameras, args.group, args.prefix, TAG, SCRIPT)
    if not args.apply:
        print("\n# go2rtc/go2rtc.yaml (dentro de streams:)")
        print(block)
        print("\n# public/config/blizzard.config.json (dentro de sources:)")
        print(json.dumps(sources, ensure_ascii=False, indent=2))
        print("\nRode de novo com --apply para gravar nos arquivos.", file=sys.stderr)
        return

    go2rtc_path = args.go2rtc or GO2RTC_PATH
    config_path = args.config or CONFIG_PATH
    apply_go2rtc(go2rtc_path, block, TAG, SCRIPT)
    os.chmod(go2rtc_path, 0o600)  # as URLs levam a senha do gravador
    apply_config(config_path, args.group, args.group_name, "intelbras", sources, args.prefix)
    placed = fill_view(config_path, args.view or args.group, args.group_name, [s["id"] for s in sources])
    print(f"\nGravado em {go2rtc_path} e {config_path}.", file=sys.stderr)
    print("Reinicie o go2rtc: docker compose restart go2rtc", file=sys.stderr)
    if placed:
        print(f"As câmeras já estão na visão \"{args.view or args.group}\".", file=sys.stderr)
    else:
        print("A visão já tinha fontes: coloque as novas nos slots do blizzard.config.json ou troque na própria tela.", file=sys.stderr)


if __name__ == "__main__":
    main()

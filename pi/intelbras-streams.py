#!/usr/bin/env python3
"""
Descobre os canais de um gravador (DVR/NVR) ou câmera Intelbras/Dahua e gera os streams RTSP
para o go2rtc e a Blizzard. Roda no Pi; só usa a biblioteca padrão.

Usa a API HTTP do equipamento (porta 80, autenticação Digest) para ler o nome de cada canal e o
codec configurado. As URLs geradas seguem o padrão:
  rtsp://USUARIO:SENHA@HOST:554/cam/realmonitor?channel=N&subtype=1   (sub-stream, grade)
  rtsp://USUARIO:SENHA@HOST:554/cam/realmonitor?channel=N&subtype=0   (stream principal, ampliado)

Exemplos:
  ./pi/intelbras-streams.py --host 192.168.15.6 --user 'admin@greenforest' --password 'SENHA'
  ./pi/intelbras-streams.py --host 192.168.15.6 --user 'admin@greenforest' --password 'SENHA' --apply
  ./pi/intelbras-streams.py --host 192.168.15.6 --user admin --password SENHA --channels 8 --apply
      (sem consultar a API: gera 8 canais chamados "Canal 1".."Canal 8")

Sem --apply, apenas imprime. Com --apply, grava:
  - go2rtc/go2rtc.yaml               entre "# >>> intelbras" e "# <<< intelbras"
                                     (criado a partir de go2rtc.example.yaml se não existir)
  - public/config/blizzard.config.json  fontes "cond-<canal>" no grupo escolhido (--group, padrão "condominio")
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blizzard_common import CONFIG_PATH, GO2RTC_PATH, apply_config, apply_go2rtc, build_outputs  # noqa: E402

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


def rtsp_url(host: str, port: int, user: str, password: str, channel: int, subtype: int) -> str:
    cred = f"{urllib.parse.quote(user, safe='')}:{urllib.parse.quote(password, safe='')}"
    return f"rtsp://{cred}@{host}:{port}/cam/realmonitor?channel={channel}&subtype={subtype}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", required=True, help="IP do gravador ou câmera Intelbras")
    parser.add_argument("--user", default=os.environ.get("INTELBRAS_USER", "admin"))
    parser.add_argument("--password", default=os.environ.get("INTELBRAS_PASSWORD"))
    parser.add_argument("--http-port", type=int, default=80, help="porta HTTP da API (padrão 80)")
    parser.add_argument("--rtsp-port", type=int, default=554, help="porta RTSP (padrão 554)")
    parser.add_argument("--channels", type=int, help="não consulta a API: gera N canais numerados")
    parser.add_argument("--group", default="condominio", help="grupo da Blizzard (padrão: condominio)")
    parser.add_argument("--group-name", default="Condomínio")
    parser.add_argument("--prefix", default="cond", help="prefixo dos streams no go2rtc (padrão: cond)")
    parser.add_argument("--apply", action="store_true", help="grava go2rtc.yaml e blizzard.config.json")
    parser.add_argument("--go2rtc", default=None)
    parser.add_argument("--config", default=None)
    args = parser.parse_args()
    if not args.password:
        parser.error("informe --password (ou a variável INTELBRAS_PASSWORD)")

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

    cameras = []
    print(f"\n{len(channels)} canal(is):", file=sys.stderr)
    for ch in channels:
        n = ch["index"] + 1
        notes = []
        if ch.get("main_codec"):
            notes.append(f"principal {ch['main_codec']}")
        if ch.get("sub_codec"):
            notes.append(f"sub {ch['sub_codec']}" + (f" {ch['sub_res']}" if ch.get("sub_res") else ""))
        if not ch.get("sub_enabled", True):
            notes.append("SUB-STREAM DESLIGADO: ligue no gravador (Codificação > Stream extra) para aliviar o Pi")
        if (ch.get("sub_codec") or "").upper().startswith("H.265") or (ch.get("main_codec") or "").upper().startswith("H.265"):
            notes.append("H.265 não toca no Chromium do Pi: mude o canal para H.264 no gravador")
        print(f"  {n:>2}. {ch['name']}" + (f"  ({'; '.join(notes)})" if notes else ""), file=sys.stderr)
        sub = 1 if ch.get("sub_enabled", True) else 0
        cameras.append({
            "name": ch["name"],
            "low": rtsp_url(args.host, args.rtsp_port, args.user, args.password, n, sub),
            "high": rtsp_url(args.host, args.rtsp_port, args.user, args.password, n, 0) if sub == 1 else None,
        })

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
    apply_config(config_path, args.group, args.group_name, "intelbras", sources, args.prefix)
    print(f"\nGravado em {go2rtc_path} e {config_path}.", file=sys.stderr)
    print("Reinicie o go2rtc: sudo docker compose restart go2rtc", file=sys.stderr)
    print("Depois coloque as fontes nas visões (slots) do blizzard.config.json ou troque na própria tela.", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Descobre as câmeras do UniFi Protect e gera os streams RTSP locais para o go2rtc e a Blizzard.

Roda no Pi (ou em qualquer máquina da mesma rede do console UniFi). Só usa a biblioteca padrão.

Autenticação (uma das duas):
  --api-key CHAVE     API do Protect (Protect > Configurações > Control Plane > Integrations > Create API key).
                      É o caminho recomendado.
  --user U --password S
                      Usuário LOCAL do UniFi OS com acesso ao Protect (Configurações > Admins > adicionar
                      usuário local). Contas Ubiquiti SSO com 2FA não funcionam aqui.

Exemplos:
  ./pi/protect-streams.py --host 192.168.155.1 --api-key XXXX
  ./pi/protect-streams.py --host 192.168.155.1 --api-key XXXX --apply
  ./pi/protect-streams.py --host 192.168.155.1 --user blizzard --password '...' --enable --apply

Sem --apply, apenas imprime o que faria. Com --apply, grava:
  - go2rtc/go2rtc.yaml               entre os marcadores "# >>> unifi-protect" e "# <<< unifi-protect"
  - public/config/blizzard.config.json  fontes "unifi-<camera>" no grupo escolhido (--group, padrão "casa")
"""
import argparse
import http.cookiejar
import json
import os
import re
import ssl
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

RTSPS_PORT_DEFAULT = 7441
MARK_BEGIN = "# >>> unifi-protect (gerado por pi/protect-streams.py; não edite entre os marcadores)"
MARK_END = "# <<< unifi-protect"


def slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "camera"


def rtspx(url: str) -> str:
    """rtsps://host:7441/ALIAS?enableSrtp  ->  rtspx://host:7441/ALIAS (forma que o go2rtc usa)."""
    url = re.sub(r"^rtsps?://", "rtspx://", url)
    return url.split("?", 1)[0]


class ProtectClient:
    def __init__(self, base_url: str, api_key: str | None, user: str | None, password: str | None, verify: bool):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.user = user
        self.password = password
        self.csrf = None
        ctx = ssl.create_default_context()
        if not verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def request(self, method: str, path: str, body=None):
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["X-API-KEY"] = self.api_key
        if self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=20) as resp:
                self._capture_csrf(resp.headers)
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as err:
            raw = err.read().decode(errors="replace")
            raise SystemExit(f"{method} {path} -> HTTP {err.code}: {raw[:300]}") from None
        except urllib.error.URLError as err:
            raise SystemExit(f"Não foi possível conectar em {self.base_url}: {err.reason}") from None

    def _capture_csrf(self, headers):
        for name in ("X-Updated-CSRF-Token", "X-CSRF-Token"):
            if headers.get(name):
                self.csrf = headers.get(name)

    # ---------- API de integração (chave de API) ----------
    def v1_cameras(self):
        _, cams = self.request("GET", "/proxy/protect/integration/v1/cameras")
        return cams or []

    def v1_streams(self, cam_id: str, qualities):
        _, existing = self.request("GET", f"/proxy/protect/integration/v1/cameras/{cam_id}/rtsps-stream")
        existing = {k: v for k, v in (existing or {}).items() if v}
        missing = [q for q in qualities if q not in existing]
        if missing:
            _, created = self.request(
                "POST", f"/proxy/protect/integration/v1/cameras/{cam_id}/rtsps-stream", {"qualities": missing}
            )
            existing.update({k: v for k, v in (created or {}).items() if v})
        return existing

    # ---------- API legada (usuário local) ----------
    def login(self):
        self.request("POST", "/api/auth/login", {"username": self.user, "password": self.password, "rememberMe": False})

    def bootstrap(self):
        _, data = self.request("GET", "/proxy/protect/api/bootstrap")
        return data

    def enable_rtsp(self, camera: dict, channel_ids):
        channels = []
        for ch in camera.get("channels", []):
            ch = dict(ch)
            if ch.get("id") in channel_ids:
                ch["isRtspEnabled"] = True
            channels.append(ch)
        self.request("PATCH", f"/proxy/protect/api/cameras/{camera['id']}", {"channels": channels})


def discover_v1(client: ProtectClient):
    """Retorna [{name, low, high}] com URLs rtspx a partir da API de integração."""
    result = []
    for cam in client.v1_cameras():
        if cam.get("state") not in (None, "CONNECTED"):
            print(f"  aviso: {cam.get('name')} está {cam.get('state')}, gerando mesmo assim", file=sys.stderr)
        streams = client.v1_streams(cam["id"], ["low", "high"])
        if not streams:
            streams = client.v1_streams(cam["id"], ["medium"])
        low = streams.get("low") or streams.get("medium")
        high = streams.get("high") or streams.get("medium")
        if not low:
            print(f"  aviso: {cam.get('name')} sem stream RTSPS disponível, pulando", file=sys.stderr)
            continue
        result.append({"name": cam["name"], "low": rtspx(low), "high": rtspx(high) if high else None})
    return result


def discover_legacy(client: ProtectClient, host: str, enable: bool):
    client.login()
    data = client.bootstrap()
    port = (data.get("nvr", {}).get("ports", {}) or {}).get("rtsps", RTSPS_PORT_DEFAULT)
    cameras = data.get("cameras", [])
    if enable:
        for cam in cameras:
            wanted = [ch["id"] for ch in cam.get("channels", []) if ch.get("name") in ("High", "Low")]
            if any(not ch.get("isRtspEnabled") for ch in cam.get("channels", []) if ch["id"] in wanted):
                print(f"  habilitando RTSP em {cam['name']}…", file=sys.stderr)
                client.enable_rtsp(cam, wanted)
        cameras = client.bootstrap().get("cameras", [])
    result = []
    for cam in cameras:
        by_name = {ch.get("name"): ch for ch in cam.get("channels", []) if ch.get("isRtspEnabled") and ch.get("rtspAlias")}
        low = by_name.get("Low") or by_name.get("Medium")
        high = by_name.get("High") or by_name.get("Medium")
        if not low:
            print(f"  aviso: {cam['name']} sem canal RTSP habilitado (use --enable ou habilite no Protect), pulando", file=sys.stderr)
            continue
        result.append({
            "name": cam["name"],
            "low": f"rtspx://{host}:{port}/{low['rtspAlias']}",
            "high": f"rtspx://{host}:{port}/{high['rtspAlias']}" if high else None,
        })
    return result


def build_outputs(cameras, group: str, prefix: str):
    yaml_lines = [MARK_BEGIN]
    sources = []
    used = set()
    for cam in cameras:
        base = f"{prefix}_{slugify(cam['name'])}"
        stream = base
        n = 2
        while stream in used:
            stream = f"{base}_{n}"
            n += 1
        used.add(stream)
        yaml_lines.append(f"  {stream}: {cam['low']}")
        source = {"type": "camera", "id": stream.replace("_", "-"), "name": cam["name"], "group": group, "stream": stream}
        if cam.get("high"):
            yaml_lines.append(f"  {stream}_hd: {cam['high']}")
            source["hdStream"] = f"{stream}_hd"
        sources.append(source)
    yaml_lines.append(MARK_END)
    return "\n".join(yaml_lines), sources


def apply_go2rtc(path: str, block: str):
    text = open(path, encoding="utf-8").read() if os.path.exists(path) else "streams:\n"
    pattern = re.compile(re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END), re.S)
    if pattern.search(text):
        text = pattern.sub(block, text)
    else:
        m = re.search(r"^streams:\s*$", text, re.M)
        if not m:
            raise SystemExit(f"{path} não tem uma seção 'streams:'.")
        text = text[: m.end()] + "\n" + block + text[m.end():]
    open(path, "w", encoding="utf-8").write(text)


def apply_config(path: str, group: str, sources):
    config = json.load(open(path, encoding="utf-8"))
    groups = {g["id"] for g in config.get("groups", [])}
    if group not in groups:
        config.setdefault("groups", []).append({"id": group, "name": group.capitalize(), "kind": "unifi_protect"})
    ids = {s["id"] for s in sources}
    kept = [s for s in config.get("sources", []) if s["id"] not in ids]
    config["sources"] = kept + sources
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", help="IP ou nome do console UniFi (UDM/UNVR/Cloud Key)")
    parser.add_argument("--url", help="URL base completa (alternativa a --host; ex.: https://192.168.1.1)")
    parser.add_argument("--api-key", default=os.environ.get("PROTECT_API_KEY"))
    parser.add_argument("--user", default=os.environ.get("PROTECT_USER"))
    parser.add_argument("--password", default=os.environ.get("PROTECT_PASSWORD"))
    parser.add_argument("--enable", action="store_true", help="(modo usuário/senha) habilita RTSP nos canais High e Low")
    parser.add_argument("--group", default="casa", help="grupo da Blizzard onde as câmeras entram (padrão: casa)")
    parser.add_argument("--prefix", default="unifi", help="prefixo dos nomes de stream no go2rtc (padrão: unifi)")
    parser.add_argument("--verify-tls", action="store_true", help="valida o certificado do console (padrão: não)")
    parser.add_argument("--apply", action="store_true", help="grava go2rtc.yaml e blizzard.config.json")
    parser.add_argument("--go2rtc", default=None, help="caminho do go2rtc.yaml (padrão: <repo>/go2rtc/go2rtc.yaml)")
    parser.add_argument("--config", default=None, help="caminho do blizzard.config.json")
    args = parser.parse_args()

    if not args.host and not args.url:
        parser.error("informe --host ou --url")
    if not args.api_key and not (args.user and args.password):
        parser.error("informe --api-key ou --user e --password")

    base_url = args.url or f"https://{args.host}"
    host = args.host or urllib.parse.urlparse(base_url).hostname
    client = ProtectClient(base_url, args.api_key, args.user, args.password, args.verify_tls)

    print(f"Consultando o Protect em {base_url}…", file=sys.stderr)
    cameras = discover_v1(client) if args.api_key else discover_legacy(client, host, args.enable)
    if not cameras:
        raise SystemExit("Nenhuma câmera com stream RTSP encontrada.")

    block, sources = build_outputs(cameras, args.group, args.prefix)
    print(f"\n{len(cameras)} câmera(s):", file=sys.stderr)
    for cam in cameras:
        print(f"  - {cam['name']}", file=sys.stderr)

    if not args.apply:
        print("\n# go2rtc/go2rtc.yaml (dentro de streams:)")
        print(block)
        print("\n# public/config/blizzard.config.json (dentro de sources:)")
        print(json.dumps(sources, ensure_ascii=False, indent=2))
        print("\nRode de novo com --apply para gravar nos arquivos.", file=sys.stderr)
        return

    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    go2rtc_path = args.go2rtc or os.path.join(repo, "go2rtc", "go2rtc.yaml")
    config_path = args.config or os.path.join(repo, "public", "config", "blizzard.config.json")
    apply_go2rtc(go2rtc_path, block)
    apply_config(config_path, args.group, sources)
    print(f"\nGravado em {go2rtc_path} e {config_path}.", file=sys.stderr)
    print("Reinicie o go2rtc: sudo docker compose restart go2rtc", file=sys.stderr)
    print("Depois coloque as fontes nas visões (slots) do blizzard.config.json ou troque na própria tela.", file=sys.stderr)


if __name__ == "__main__":
    main()

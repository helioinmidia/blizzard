#!/usr/bin/env python3
"""
API mínima de configuração da Blizzard. Só biblioteca padrão.

  GET  /api/config   -> conteúdo de blizzard.config.json (ETag = versão do arquivo)
  PUT  /api/config   -> valida e grava o JSON recebido (gravação atômica)
  GET  /api/health   -> {"ok": true}

Variáveis: CONFIG_PATH (padrão ./public/config/blizzard.config.json), PORT (padrão 8787), BIND (127.0.0.1).
"""
import json
import re
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG_PATH = os.environ.get("CONFIG_PATH") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "config", "blizzard.config.json"
)
PORT = int(os.environ.get("PORT", "8787"))
BIND = os.environ.get("BIND", "127.0.0.1")
MAX_BODY = 2 * 1024 * 1024

SOURCE_KINDS = {"unifi_protect", "intelbras", "home_assistant", "other"}


class ConfigError(ValueError):
    pass


ENTITY_ID = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def validate(raw):
    """Mesmas regras de src/lib/config.ts, para recusar um JSON que a tela não conseguiria carregar."""
    if not isinstance(raw, dict):
        raise ConfigError("a configuração deve ser um objeto JSON")
    groups = raw.get("groups", [])
    sources = raw.get("sources", [])
    views = raw.get("views", [])
    for name, value in (("groups", groups), ("sources", sources), ("views", views)):
        if not isinstance(value, list):
            raise ConfigError(f'"{name}" deve ser uma lista')
    group_ids = set()
    for i, g in enumerate(groups):
        if not isinstance(g, dict) or not g.get("id") or not g.get("name"):
            raise ConfigError(f'"groups[{i}]" precisa de "id" e "name"')
        if g.get("kind", "other") not in SOURCE_KINDS:
            raise ConfigError(f'"groups[{i}].kind" deve ser um de: {", ".join(sorted(SOURCE_KINDS))}')
        if g["id"] in group_ids:
            raise ConfigError(f'grupo "{g["id"]}" repetido')
        group_ids.add(g["id"])
    source_ids = set()
    for i, s in enumerate(sources):
        if not isinstance(s, dict) or not s.get("id") or not s.get("name") or not s.get("group"):
            raise ConfigError(f'"sources[{i}]" precisa de "id", "name" e "group"')
        if s["group"] not in group_ids:
            raise ConfigError(f'"sources[{i}].group" referencia o grupo "{s["group"]}", que não existe')
        kind = s.get("type", "camera")
        if kind == "camera" and not s.get("stream"):
            raise ConfigError(f'"sources[{i}].stream" é obrigatório para câmeras')
        if kind == "dashboard" and not s.get("url"):
            raise ConfigError(f'"sources[{i}].url" é obrigatório para painéis')
        if kind == "ha":
            cards = s.get("cards")
            if not isinstance(cards, list):
                raise ConfigError(f'"sources[{i}].cards" deve ser uma lista de cartões')
            for j, card in enumerate(cards):
                if not isinstance(card, dict) or not card.get("title") or not isinstance(card.get("entities"), list):
                    raise ConfigError(f'"sources[{i}].cards[{j}]" precisa de "title" e de uma lista "entities"')
                for k, ref in enumerate(card["entities"]):
                    entity = ref.get("entity") if isinstance(ref, dict) else ref
                    if not isinstance(entity, str) or not ENTITY_ID.match(entity):
                        raise ConfigError(f'"sources[{i}].cards[{j}].entities[{k}]" deve ser um entity_id do Home Assistant')
        if kind not in ("camera", "dashboard", "ha"):
            raise ConfigError(f'"sources[{i}].type" deve ser "camera", "dashboard" ou "ha"')
        if s["id"] in source_ids:
            raise ConfigError(f'fonte "{s["id"]}" repetida')
        source_ids.add(s["id"])
    view_ids = set()
    for i, v in enumerate(views):
        if not isinstance(v, dict) or not v.get("id") or not v.get("name"):
            raise ConfigError(f'"views[{i}]" precisa de "id" e "name"')
        cols, rows = v.get("columns", 2), v.get("rows", 2)
        if not all(isinstance(n, int) and 1 <= n <= 6 for n in (cols, rows)):
            raise ConfigError(f'"views[{i}]" deve ter entre 1 e 6 colunas e linhas')
        for j, slot in enumerate(v.get("slots", [])):
            if slot not in (None, "") and slot not in source_ids:
                raise ConfigError(f'"views[{i}].slots[{j}]" referencia a fonte "{slot}", que não existe')
        if v["id"] in view_ids:
            raise ConfigError(f'visão "{v["id"]}" repetida')
        view_ids.add(v["id"])


def read_config():
    with open(CONFIG_PATH, "rb") as fh:
        return fh.read()


def write_config(data: bytes):
    directory = os.path.dirname(CONFIG_PATH) or "."
    fd, tmp = tempfile.mkstemp(prefix=".blizzard-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, CONFIG_PATH)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def etag():
    st = os.stat(CONFIG_PATH)
    return f'"{int(st.st_mtime_ns)}-{st.st_size}"'


class Handler(BaseHTTPRequestHandler):
    server_version = "blizzard-config/1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body: bytes, content_type="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code, message):
        self._send(code, json.dumps({"error": message}, ensure_ascii=False).encode())

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._send(200, b'{"ok":true}')
        if path == "/api/config":
            try:
                tag = etag()
                if self.headers.get("If-None-Match") == tag:
                    self.send_response(304)
                    self.send_header("ETag", tag)
                    self.end_headers()
                    return
                return self._send(200, read_config(), extra={"ETag": tag})
            except FileNotFoundError:
                return self._error(404, f"{CONFIG_PATH} não existe")
        self._error(404, "rota desconhecida")

    do_HEAD = do_GET

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/config":
            return self._error(404, "rota desconhecida")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._error(413 if length > MAX_BODY else 400, "corpo vazio ou grande demais")
        body = self.rfile.read(length)
        try:
            raw = json.loads(body.decode("utf-8"))
            validate(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            return self._error(400, f"JSON inválido: {err}")
        except ConfigError as err:
            return self._error(400, str(err))
        pretty = (json.dumps(raw, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        try:
            write_config(pretty)
        except OSError as err:
            return self._error(500, f"não consegui gravar {CONFIG_PATH}: {err}")
        self._send(200, pretty, extra={"ETag": etag()})


def main():
    print(f"blizzard config-api em http://{BIND}:{PORT} (arquivo: {CONFIG_PATH})", file=sys.stderr)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

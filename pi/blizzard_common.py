"""Funções compartilhadas pelos scripts pi/*-streams.py (gravação no go2rtc.yaml e no blizzard.config.json)."""
import json
import os
import re
import shutil
import unicodedata

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GO2RTC_PATH = os.path.join(REPO_DIR, "go2rtc", "go2rtc.yaml")
GO2RTC_EXAMPLE = os.path.join(REPO_DIR, "go2rtc", "go2rtc.example.yaml")
CONFIG_PATH = os.path.join(REPO_DIR, "public", "config", "blizzard.config.json")


def slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "camera"


def markers(tag: str, script: str):
    begin = f"# >>> {tag} (gerado por {script}; não edite entre os marcadores)"
    end = f"# <<< {tag}"
    return begin, end


def build_outputs(cameras, group: str, prefix: str, tag: str, script: str):
    """cameras: [{name, low, high|None}] -> (bloco YAML, lista de fontes da Blizzard)."""
    begin, end = markers(tag, script)
    yaml_lines = [begin]
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
    yaml_lines.append(end)
    return "\n".join(yaml_lines), sources


def apply_go2rtc(path: str, block: str, tag: str, script: str):
    if not os.path.exists(path):
        if os.path.exists(GO2RTC_EXAMPLE) and os.path.abspath(path) == os.path.abspath(GO2RTC_PATH):
            shutil.copyfile(GO2RTC_EXAMPLE, path)
        else:
            open(path, "w", encoding="utf-8").write("api:\n  listen: \":1984\"\n\nstreams:\n")
    text = open(path, encoding="utf-8").read()
    begin, end = markers(tag, script)
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if pattern.search(text):
        text = pattern.sub(lambda _: block, text)
    else:
        m = re.search(r"^streams:[ \t]*$", text, re.M)
        if not m:
            raise SystemExit(f"{path} não tem uma seção 'streams:'.")
        text = text[: m.end()] + "\n\n" + block + "\n" + text[m.end():]
    if not text.endswith("\n"):
        text += "\n"
    open(path, "w", encoding="utf-8").write(text)


def apply_config(path: str, group: str, group_name: str, kind: str, sources, prefix: str):
    """Substitui as fontes geradas (mesmo id) e remove câmeras antigas do grupo cujo stream usa o
    mesmo prefixo e não foi regenerado (ex.: os exemplos cond_* do repositório). Células que
    apontavam para fontes removidas ficam vazias, para a configuração continuar válida."""
    config = json.load(open(path, encoding="utf-8"))
    groups = {g["id"] for g in config.get("groups", [])}
    if group not in groups:
        config.setdefault("groups", []).append({"id": group, "name": group_name, "kind": kind})
    ids = {s["id"] for s in sources}
    streams = {s["stream"] for s in sources}

    def stale(source):
        return (
            source.get("type", "camera") == "camera"
            and source.get("group") == group
            and str(source.get("stream", "")).startswith(prefix + "_")
            and source["stream"] not in streams
        )

    removed = {s["id"] for s in config.get("sources", []) if stale(s)}
    kept = [s for s in config.get("sources", []) if s["id"] not in ids and s["id"] not in removed]
    config["sources"] = kept + sources
    for view in config.get("views", []):
        view["slots"] = [None if slot in removed else slot for slot in view.get("slots", [])]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

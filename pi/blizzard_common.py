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


def build_outputs(cameras, group: str, prefix: str, tag: str, script: str, h264: bool = False):
    """cameras: [{name, low, high|None}] -> (bloco YAML, lista de fontes da Blizzard).

    h264=True: câmeras em H.265, que o Chromium do Pi não toca. O nome de sempre passa a ser a versão H.264
    do stream Low (template ffmpeg "h264/pi" do go2rtc.yaml) e o High fica sem uso, porque o Pi 4 não
    consegue convertê-lo em tempo real.
    """
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
        transcode = h264 or cam.get("h264", False)  # por câmera (codec detectado) ou para todas
        if transcode:
            yaml_lines.append(f"  {stream}_src: {cam['low']}")
            yaml_lines.append(f"  {stream}: ffmpeg:{stream}_src#video=h264/pi")
        else:
            yaml_lines.append(f"  {stream}: {cam['low']}")
        source = {"type": "camera", "id": stream.replace("_", "-"), "name": cam["name"], "group": group, "stream": stream}
        if cam.get("high"):
            yaml_lines.append(f"  {stream}_hd: {cam['high']}")
            if not transcode:
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


GRID_SIZES = [(1, 1), (2, 1), (2, 2), (3, 2), (3, 3), (4, 3), (4, 4), (5, 4), (6, 4), (6, 5), (6, 6)]


def fill_view(path: str, view_id: str, view_name: str, source_ids):
    """Coloca as fontes numa visão, sem desfazer arrumação feita à mão: só cria a visão ou preenche uma que
    esteja inteiramente vazia. Devolve True se gravou."""
    config = json.load(open(path, encoding="utf-8"))
    views = config.setdefault("views", [])
    view = next((v for v in views if v.get("id") == view_id), None)
    if view is not None and any(slot for slot in view.get("slots", [])):
        return False
    columns, rows = next(((c, r) for c, r in GRID_SIZES if c * r >= len(source_ids)), (6, 6))
    slots = list(source_ids)[: columns * rows] + [None] * max(0, columns * rows - len(source_ids))
    if view is None:
        views.append({"id": view_id, "name": view_name, "columns": columns, "rows": rows, "slots": slots})
    else:
        view.update({"columns": columns, "rows": rows, "slots": slots})
        view.pop("spans", None)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return True

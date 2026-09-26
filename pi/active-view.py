#!/usr/bin/env python3
"""
Monta uma visão só com as câmeras que estão entregando imagem agora.

Para cada fonte do tipo câmera pede um quadro ao go2rtc (/api/frame.jpeg); as que respondem entram
na visão, na ordem dos grupos e dos nomes, até o limite. A visão é gravada pela API de configuração,
então todas as telas (TV, laptop) recarregam sozinhas.

  ./pi/active-view.py                               # visão "geral", 4x2, até 8 câmeras
  ./pi/active-view.py --view geral --columns 3 --rows 2 --limit 6
  ./pi/active-view.py --dry-run                     # só mostra o que faria

Só biblioteca padrão. Roda no Pi (fala com o go2rtc e a API em localhost).
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def natural_key(name: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.load(resp)


def has_picture(go2rtc: str, stream: str, timeout: float) -> bool:
    url = f"{go2rtc}/api/frame.jpeg?src={urllib.parse.quote(stream)}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200 and len(resp.read()) > 0
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--view", default="geral", help="id da visão a montar (criada se não existir)")
    ap.add_argument("--name", default=None, help="nome da visão, se for criada (padrão: id capitalizado)")
    ap.add_argument("--columns", type=int, default=4)
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--limit", type=int, default=8, help="máximo de câmeras (padrão 8)")
    ap.add_argument("--api", default="http://127.0.0.1:8787", help="API de configuração")
    ap.add_argument("--go2rtc", default="http://127.0.0.1:1984", help="go2rtc")
    ap.add_argument("--timeout", type=float, default=8.0, help="segundos para cada câmera responder")
    ap.add_argument("--keep-empty", action="store_true", help="deixa células vazias em vez de encolher a grade")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        config = fetch_json(f"{args.api}/api/config")
    except Exception as err:  # noqa: BLE001
        sys.exit(f"Não consegui ler a configuração em {args.api}: {err}")

    order = {g["id"]: i for i, g in enumerate(config.get("groups", []))}
    cameras = [s for s in config.get("sources", []) if s.get("type", "camera") == "camera"]
    cameras.sort(key=lambda s: (order.get(s["group"], 99), natural_key(s["name"])))

    active = []
    print(f"Testando {len(cameras)} câmera(s) no go2rtc ({args.timeout:.0f} s cada, no máximo)…", file=sys.stderr)
    for cam in cameras:
        # Duas tentativas: a primeira pode só ter acordado o stream no go2rtc.
        ok = has_picture(args.go2rtc, cam["stream"], args.timeout) or has_picture(args.go2rtc, cam["stream"], args.timeout)
        print(f"  {'OK  ' if ok else 'sem '} {cam['name']:<24} {cam['stream']}", file=sys.stderr)
        if ok:
            active.append(cam["id"])

    if not active:
        sys.exit("Nenhuma câmera respondeu; a visão não foi alterada.")

    chosen = active[: args.limit]
    total = args.columns * args.rows
    if len(chosen) > total:
        print(f"aviso: {len(chosen)} ativas, mas a grade {args.columns}x{args.rows} só tem {total} células", file=sys.stderr)
        chosen = chosen[:total]

    columns, rows = args.columns, args.rows
    if not args.keep_empty and len(chosen) < total:
        # Encolhe a grade para não sobrar célula vazia: menos linhas, depois menos colunas.
        while rows > 1 and columns * (rows - 1) >= len(chosen):
            rows -= 1
        while columns > 1 and (columns - 1) * rows >= len(chosen):
            columns -= 1
    slots = chosen + [None] * (columns * rows - len(chosen))

    views = config.setdefault("views", [])
    view = next((v for v in views if v["id"] == args.view), None)
    if view is None:
        view = {"id": args.view, "name": args.name or args.view.capitalize()}
        views.insert(0, view)
    view.pop("spans", None)
    view.update({"columns": columns, "rows": rows, "slots": slots})

    names = {s["id"]: s["name"] for s in config["sources"]}
    print(f"\nVisão '{args.view}': {columns}x{rows} com {len(chosen)} câmera(s): {', '.join(names[i] for i in chosen)}", file=sys.stderr)
    if args.dry_run:
        print("(dry-run: nada gravado)", file=sys.stderr)
        return

    body = json.dumps(config, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{args.api}/api/config", data=body, method="PUT", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.HTTPError as err:
        sys.exit(f"A API recusou a configuração (HTTP {err.code}): {err.read().decode(errors='replace')[:300]}")
    print("Gravado. As telas recarregam em até 10 s.", file=sys.stderr)


if __name__ == "__main__":
    main()

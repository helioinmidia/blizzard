#!/usr/bin/env python3
"""
Sonda do serviço P2P (Dahua/Intelbras): pergunta a cada servidor de nuvem se o gravador com o
número de série informado está registrado e online. Só biblioteca padrão; roda no Pi.

  ./pi/intelbras-p2p-probe.py RK1M11005028H
  ./pi/intelbras-p2p-probe.py RK1M11005028H --server intelbrasp2p.com.br:8800

Interpretação:
  - "/probe/device" com 200 no servidor de dispositivo (US) -> o gravador está registrado E online nessa nuvem
  - "/online/p2psrv" 200 mas "/probe/device" 404          -> essa nuvem não é a dele (o servidor principal do Easy4IP
                                                             responde 200 para qualquer serial; só o probe/device conta)
  - sem resposta (timeout)                                 -> porta errada, UDP bloqueado ou servidor que ignora
                                                             credenciais de cliente desconhecidas
  - 401 / 403                                              -> o servidor exige credenciais de cliente próprias

Varredura de portas num servidor (útil para descobrir a porta da nuvem de um fabricante):
  ./pi/intelbras-p2p-probe.py RK1M11005028H --scan intelbrasp2p.com.br
"""
import argparse
import base64
import datetime
import hashlib
import random
import socket
import sys

DEFAULT_SERVERS = [
    "intelbrasp2p.com.br:8800",
    "www.intelbrasp2p.com.br:8800",
    "www.easy4ipcloud.com:8800",
]
# Portas já vistas em nuvens Dahua e derivadas (Easy4IP 8800; Amcrest 12366/12367) e vizinhas.
SCAN_PORTS = [8800, 8801, 8802, 8803, 8900, 9800, 9801, 12366, 12367, 12368, 37777, 37778, 8000, 8080, 443, 80]
# Credenciais de cliente do app Dahua (as mesmas que o dh-p2p usa para o Easy4IP).
DEFAULT_USERNAME = "cba1b29e32cb17aa46b8ff9e73c7f40b"
DEFAULT_USERKEY = "996103384cdf19179e19243e959bbf8b"


def build_request(path: str, cseq: int, username: str, userkey: str) -> bytes:
    nonce = random.randrange(2**31)
    created = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    digest = base64.b64encode(hashlib.sha1(f"{nonce}{created}DHP2P:{username}:{userkey}".encode()).digest()).decode()
    lines = [
        f"DHGET {path} HTTP/1.1",
        f"CSeq: {cseq}",
        'Authorization: WSSE profile="UsernameToken"',
        f'X-WSSE: UsernameToken Username="{username}", PasswordDigest="{digest}", Nonce="{nonce}", Created="{created}"',
        "",
        "",
    ]
    return "\r\n".join(lines).encode()


def parse(data: bytes):
    text = data.decode(errors="replace")
    head, _, body = text.partition("\r\n\r\n")
    first = head.split("\r\n")[0].split(" ", 2)
    code = int(first[1]) if len(first) > 1 and first[1].isdigit() else -1
    status = first[2] if len(first) > 2 else ""
    return code, status, body.strip()


def query(server: str, path: str, username: str, userkey: str, timeout: float, cseq: int):
    host, _, port = server.partition(":")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(build_request(path, cseq, username, userkey), (host, int(port or 8800)))
        data, _ = sock.recvfrom(8192)
        return parse(data)
    except socket.gaierror:
        return -2, "DNS não resolveu", ""
    except socket.timeout:
        return -3, "sem resposta (timeout)", ""
    finally:
        sock.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("serial", help="número de série do gravador (ID Cloud no app Intelbras)")
    ap.add_argument("--server", action="append", help="host:porta a testar (pode repetir); padrão: Intelbras e Easy4IP")
    ap.add_argument("--username", default=DEFAULT_USERNAME, help="usuário de cliente WSSE (padrão: o do app Dahua)")
    ap.add_argument("--userkey", default=DEFAULT_USERKEY)
    ap.add_argument("--timeout", type=float, default=5.0)
    ap.add_argument("--scan", metavar="HOST", help="varre portas conhecidas nesse host em vez da lista de servidores")
    args = ap.parse_args()

    if args.scan:
        hits = []
        for port in SCAN_PORTS:
            server = f"{args.scan}:{port}"
            code, status, _ = query(server, "/probe/p2psrv", args.username, args.userkey, min(args.timeout, 3.0), 1)
            print(f"   {server:<40} {code} {status}")
            if code >= 0:
                hits.append(server)
        print()
        print("Portas que responderam ao protocolo P2P: " + (", ".join(hits) if hits else "nenhuma"))
        sys.exit(0 if hits else 1)

    found = None
    for server in args.server or DEFAULT_SERVERS:
        print(f"== {server}")
        code, status, body = query(server, "/probe/p2psrv", args.username, args.userkey, args.timeout, 1)
        print(f"   probe : {code} {status}")
        if code < 0:
            continue
        code, status, body = query(server, f"/online/p2psrv/{args.serial}", args.username, args.userkey, args.timeout, 2)
        print(f"   online: {code} {status}")
        if body:
            print("   " + body.replace("\n", "\n   "))
        if code != 200:
            continue
        us = None
        for tag in ("US", "DS"):
            start, end = body.find(f"<{tag}>"), body.find(f"</{tag}>")
            if start >= 0 and end > start:
                us = us or body[start + len(tag) + 2 : end]
        if not us:
            print("   (resposta sem servidor de dispositivo US/DS)")
            continue
        code, status, body = query(us, f"/probe/device/{args.serial}", args.username, args.userkey, args.timeout, 3)
        print(f"   device: {code} {status}  (servidor de dispositivo {us})")
        if code == 200:
            found = server
        elif code == 404:
            print("   -> o gravador não está registrado nesta nuvem (o 200 anterior não conta)")
    print()
    if found:
        print(f"Gravador registrado e online em: {found}")
        print(f"Use no túnel: DH_P2P_SERVER={found}")
        sys.exit(0)
    print("Nenhuma nuvem testada tem o gravador online. Veja a interpretação no topo do script.")
    sys.exit(1)


if __name__ == "__main__":
    main()

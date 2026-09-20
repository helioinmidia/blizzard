#!/usr/bin/env python3
"""
Sonda do serviço P2P (Dahua/Intelbras): pergunta a cada servidor de nuvem se o gravador com o
número de série informado está registrado e online. Só biblioteca padrão; roda no Pi.

  ./pi/intelbras-p2p-probe.py RK1M11005028H
  ./pi/intelbras-p2p-probe.py RK1M11005028H --server intelbrasp2p.com.br:8800

Interpretação:
  - "/online/p2psrv" com código 200 e um campo US  -> o gravador está registrado nesse servidor (é ele que o túnel deve usar)
  - 404 / "not found"                               -> não é esse servidor
  - sem resposta (timeout)                           -> UDP bloqueado ou servidor errado
  - 401 / 403                                       -> o servidor exige credenciais de cliente diferentes das do Easy4IP
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
    args = ap.parse_args()

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
        if code == 200:
            found = server
    print()
    if found:
        print(f"Gravador registrado em: {found}")
        print(f"Use no docker-compose: DH_P2P_SERVER={found}")
        sys.exit(0)
    print("Nenhum servidor reconheceu o número de série. Veja a interpretação no topo do script.")
    sys.exit(1)


if __name__ == "__main__":
    main()

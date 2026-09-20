#!/usr/bin/env python3
"""
Aplicado durante o build da imagem (pi/p2p/Dockerfile) sobre o código do dh-p2p
(https://github.com/khoanguyen-3fc/dh-p2p, MIT). Torna configuráveis por variável de ambiente:

  DH_P2P_SERVER    servidor P2P principal   (padrão www.easy4ipcloud.com:8800; Intelbras: intelbrasp2p.com.br:8800)
  DH_P2P_USERNAME  usuário de cliente WSSE  (padrão: o do app Dahua)
  DH_P2P_USERKEY   chave de cliente WSSE

Falha com mensagem clara se o código-fonte do dh-p2p mudar e as âncoras não forem encontradas.
"""
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "src/dh.rs"
source = open(path, encoding="utf-8").read()

replacements = [
    (
        "use std::{collections::HashMap, net::SocketAddrV4};",
        "use std::{collections::HashMap, net::SocketAddrV4, sync::LazyLock};",
    ),
    (
        'static MAIN_SERVER: &str = "www.easy4ipcloud.com:8800";\n\n'
        'static USERNAME: &str = "cba1b29e32cb17aa46b8ff9e73c7f40b";\n'
        'static USERKEY: &str = "996103384cdf19179e19243e959bbf8b";\n',
        "// Servidor P2P e credenciais de cliente configuráveis por ambiente (patch da Blizzard).\n"
        "static MAIN_SERVER: LazyLock<String> = LazyLock::new(|| {\n"
        '    std::env::var("DH_P2P_SERVER").unwrap_or_else(|_| "www.easy4ipcloud.com:8800".to_string())\n'
        "});\n"
        "static USERNAME: LazyLock<String> = LazyLock::new(|| {\n"
        '    std::env::var("DH_P2P_USERNAME").unwrap_or_else(|_| "cba1b29e32cb17aa46b8ff9e73c7f40b".to_string())\n'
        "});\n"
        "static USERKEY: LazyLock<String> = LazyLock::new(|| {\n"
        '    std::env::var("DH_P2P_USERKEY").unwrap_or_else(|_| "996103384cdf19179e19243e959bbf8b".to_string())\n'
        "});\n",
    ),
    (
        "socket.connect(MAIN_SERVER).await.unwrap();",
        "socket.connect(MAIN_SERVER.as_str()).await.unwrap();",
    ),
    (
        "socket2.connect(MAIN_SERVER).await.unwrap();",
        "socket2.connect(MAIN_SERVER.as_str()).await.unwrap();",
    ),
    (
        'let pwd = format!("{}{}DHP2P:{}:{}", nonce, currdate, USERNAME, USERKEY);',
        'let pwd = format!("{}{}DHP2P:{}:{}", nonce, currdate, USERNAME.as_str(), USERKEY.as_str());',
    ),
    (
        "method, path, seq, USERNAME, digest, nonce, currdate, body,",
        "method, path, seq, USERNAME.as_str(), digest, nonce, currdate, body,",
    ),
]

for old, new in replacements:
    if old not in source:
        sys.exit(f"patch-dh-p2p: âncora não encontrada em {path}:\n{old}")
    source = source.replace(old, new)

open(path, "w", encoding="utf-8").write(source)
print(f"patch-dh-p2p: {len(replacements)} trechos ajustados em {path}")

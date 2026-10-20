#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serve.py — servidor de desarrollo con aislamiento entre orígenes (COOP/COEP).

UZDoom-WASM usa pthreads de Emscripten, que necesitan `SharedArrayBuffer` y por
tanto `crossOriginIsolated === true`. GitHub Pages no manda esas cabeceras, de
ahí el Service Worker (public/coi-serviceworker.js); este servidor las manda
directamente para desarrollo local y para las pruebas automatizadas.

Por defecto sirve la RAÍZ DEL REPOSITORIO, no `public/`, porque el HTML enlaza
`../../../css/demos.css` (las rutas reales de despliegue en GitHub Pages).

Uso:
    python scripts/serve.py                 # http://127.0.0.1:8080/demos/DOOM-ZombieEscape/public/
    python scripts/serve.py --port 9000
    python scripts/serve.py --root demos/DOOM-ZombieEscape/public --demo-path ""
"""

from __future__ import annotations

import argparse
import functools
import http.server
import os
import socket
import socketserver
import sys
from pathlib import Path

DEMO_REL = "demos/DOOM-ZombieEscape/public/"

EXTRA_TYPES = {
    ".wasm": "application/wasm",
    ".data": "application/octet-stream",
    ".pk3": "application/zip",
    ".pk7": "application/zip",
    ".wad": "application/octet-stream",
    ".ipk3": "application/zip",
    ".sf2": "application/octet-stream",
    ".wopn": "application/octet-stream",
    ".wopl": "application/octet-stream",
    ".zc": "text/plain; charset=utf-8",
    ".zscript": "text/plain; charset=utf-8",
    ".mapinfo": "text/plain; charset=utf-8",
    ".cvarinfo": "text/plain; charset=utf-8",
}


class IsolationHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler + cabeceras de aislamiento y MIME del motor."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        **EXTRA_TYPES,
    }

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401 - silencio selectivo
        # Silencia el ruido de los sondeos HEAD del precargador del motor.
        msg = fmt % args
        if " 200 " in msg or " 304 " in msg:
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), msg))


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parents[3]
    ap = argparse.ArgumentParser(description="Servidor local con COOP/COEP para DOOM-ZombieEscape")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--root", default=str(repo_root), help="directorio servido (default: raíz del repo)")
    ap.add_argument("--demo-path", default=DEMO_REL, help="ruta relativa del demo dentro de --root")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not (root / args.demo_path / "index.html").exists():
        print(
            f"AVISO: no existe {root / args.demo_path / 'index.html'}; se sirve {root} igualmente",
            file=sys.stderr,
        )

    handler = functools.partial(IsolationHandler, directory=str(root))

    port = args.port
    for attempt in range(10):
        try:
            httpd = ThreadedServer((args.host, port), handler)
            break
        except OSError:
            port += 1
    else:
        print("ERROR: no se pudo abrir ningún puerto", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{port}/{args.demo_path}".rstrip("/") + "/"
    print(f"Sirviendo {root}")
    print(f"  demo: {url}")
    print("  cabeceras: COOP same-origin / COEP require-corp (SharedArrayBuffer habilitado)")
    print("Ctrl+C para detener.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

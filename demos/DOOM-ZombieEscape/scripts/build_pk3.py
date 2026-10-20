#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_pk3.py — Genera `maps/MAP01.wad` (retícula Z^2) y compila
`public/mods/zombie-escape.pk3` para The Zombie Escape (GZDoom / UZDoom).

Sólo usa la biblioteca estándar (struct, zipfile, zlib), tal como exige la
especificación §4.1. No requiere nodebuilder ni editor de mapas: el BSP de la
sala se construye a mano (es una sala convexa de 4 paredes, el caso más simple
posible) y el BLOCKMAP se calcula aquí mismo.

Geometría
---------
  * Sala cuadrada plana, 16384 x 16384 map units, centrada en (0,0).
  * Retícula Z^2 implícita: celdas de 64 x 64 (256 x 256 celdas).
  * Un único sector (altura de piso 0, techo 128), texturas propias del mod:
      flats/DZEFLOOR.png  -> cuadrícula 64x64 con marcas en los nodos
      flats/DZECEIL.png   -> techo oscuro
      textures/DZEWALL.png-> pared de ladrillo técnico
  * Thing 1 (Player 1 Start) en (0,0).

Uso
---
    python scripts/build_pk3.py                # construye y verifica
    python scripts/build_pk3.py --verify       # solo re-verifica el pk3 final
    python scripts/build_pk3.py --dump-wad DIR # deja MAP01.wad suelto en DIR
"""

from __future__ import annotations

import argparse
import io
import json
import math
import struct
import sys
import zipfile
import zlib
from pathlib import Path

# --------------------------------------------------------------------------
# Constantes de la retícula (deben coincidir con pk3_src/zscript/dze_constants.zc)
# --------------------------------------------------------------------------
CELL = 64                    # map units por celda de Z^2
HALF_CELLS = 128             # celdas por semieje: -128..128
HALF = HALF_CELLS * CELL     # 8192 map units
CEIL_HEIGHT = 128
LATTICE_HALF = 120           # radio de la nube de zombis (celdas)

ROOT = Path(__file__).resolve().parent.parent
PK3_SRC = ROOT / "pk3_src"
BUILD = ROOT / "build"
PK3_OUT = ROOT / "public" / "mods" / "zombie-escape.pk3"

FLOOR_FLAT = "DZEFLOOR"
CEIL_FLAT = "DZECEIL"
WALL_TEX = "DZEWALL"

# Orden canónico de los lumps de un mapa Doom.
MAP_LUMP_ORDER = [
    "THINGS",
    "LINEDEFS",
    "SIDEDEFS",
    "VERTEXES",
    "SEGS",
    "SSECTORS",
    "NODES",
    "SECTORS",
    "REJECT",
    "BLOCKMAP",
]


# --------------------------------------------------------------------------
# Utilidades binarias
# --------------------------------------------------------------------------
def pack_wad(lumps: list[tuple[str, bytes]], kind: bytes = b"PWAD") -> bytes:
    """Serializa una lista (nombre, datos) como WAD."""
    header_size = 12
    body = bytearray()
    directory = []
    offset = header_size
    for name, data in lumps:
        directory.append((offset, len(data), name))
        body.extend(data)
        offset += len(data)
    dir_offset = header_size + len(body)

    out = bytearray()
    out.extend(kind)
    out.extend(struct.pack("<ii", len(lumps), dir_offset))
    out.extend(body)
    for off, size, name in directory:
        raw = name.encode("ascii")
        if len(raw) > 8:
            raise ValueError(f"nombre de lump demasiado largo: {name!r}")
        out.extend(struct.pack("<ii", off, size))
        out.extend(raw.ljust(8, b"\x00"))
    return bytes(out)


def bam(dx: float, dy: float) -> int:
    """Ángulo BAM (0..65535) de un vector, como lo usa SEGS."""
    if dx == 0 and dy == 0:
        return 0
    return int(round(math.degrees(math.atan2(dy, dx)) / 360.0 * 65536.0)) & 0xFFFF


# --------------------------------------------------------------------------
# PNG mínimo (truecolor, sin filtros) para flats y texturas
# --------------------------------------------------------------------------
def png_rgb(width: int, height: int, pixel) -> bytes:
    """PNG RGB de 8 bits. `pixel(x, y) -> (r, g, b)`."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filtro "None"
        for x in range(width):
            r, g, b = pixel(x, y)
            raw.extend((r & 0xFF, g & 0xFF, b & 0xFF))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def make_floor_flat() -> bytes:
    """Cuadrícula 64x64: base en damero tenue + aristas marcadas + nodo central.

    Al repetirse cada 64 map units, dibuja visualmente las aristas de Z^2 y
    deja un punto en cada nodo de la retícula (centro de celda).
    """

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        checker = 6 if ((x // 16) + (y // 16)) % 2 == 0 else 0
        base = (34 + checker, 37 + checker, 44 + checker)
        # Aristas de la celda (los dos primeros píxeles de cada eje).
        if x < 2 or y < 2:
            return (96, 108, 128)
        if x < 4 or y < 4:
            return (56, 62, 74)
        # Punto del nodo de la retícula en el centro de la celda.
        dx, dy = abs(x - 32), abs(y - 32)
        if dx <= 1 and dy <= 1:
            return (196, 172, 120)
        if dx <= 3 and dy <= 3:
            return (120, 110, 88)
        return base

    return png_rgb(CELL, CELL, pixel)


def make_ceiling_flat() -> bytes:
    def pixel(x: int, y: int) -> tuple[int, int, int]:
        checker = 4 if ((x // 32) + (y // 32)) % 2 == 0 else 0
        vignette = 3 if min(x, y, 63 - x, 63 - y) < 3 else 0
        v = 20 + checker + vignette
        return (v, v + 1, v + 4)

    return png_rgb(CELL, CELL, pixel)


def make_wall_texture() -> bytes:
    """Ladrillo técnico 64x64 con junta horizontal cada 16 px."""

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        row = y // 16
        offset = 8 if row % 2 else 0
        mortar = (y % 16 == 0) or ((x + offset) % 16 == 0)
        if mortar:
            return (30, 30, 34)
        shade = 10 if (row + ((x + offset) // 16)) % 2 else 0
        base = (88 + shade, 74 + shade, 62 + shade)
        if y % 16 == 1:
            base = (base[0] + 14, base[1] + 14, base[2] + 14)
        return base

    return png_rgb(CELL, CELL, pixel)


# --------------------------------------------------------------------------
# Mapa
# --------------------------------------------------------------------------
def build_map_lumps() -> list[tuple[str, bytes]]:
    """Construye los 10 lumps del mapa (sala convexa + BSP de 2 subsectores).

    El BSP se construye a mano. Para no depender de *minisegs* (los SEGS con
    linedef = -1 que GZDoom marca como "nonexistant linedef" y luego reconstruye),
    la sala se parte con una línea de dos lados que la cruza por x = 0 y que
    tiene el MISMO sector a ambos lados: así cada subsector queda cerrado por
    segs que referencian linedefs reales.
    """
    # --- Vértices ---------------------------------------------------------
    # 0..3: esquinas en sentido horario (interior a la derecha de cada línea,
    # que es la convención de Doom: "el sector está del lado derecho").
    verts = [
        (-HALF, -HALF),  # 0 suroeste
        (-HALF, HALF),   # 1 noroeste
        (HALF, HALF),    # 2 noreste
        (HALF, -HALF),   # 3 sureste
        (0, -HALF),      # 4 centro-sur (partición BSP)
        (0, HALF),       # 5 centro-norte
    ]

    # --- Líneas -----------------------------------------------------------
    # 0..3: paredes (un solo lado, bloqueantes).
    # 4   : línea interior de dos lados que parte la sala (sector 0 en ambos).
    walls = [(0, 1), (1, 2), (2, 3), (3, 0)]
    interior = (4, 5)
    lines = walls + [interior]
    ONE_SIDED = 1  # ML_BLOCKING

    # --- Sidedefs ---------------------------------------------------------
    sides = [{"sector": 0, "mid": WALL_TEX} for _ in walls]
    sides.append({"sector": 0, "mid": "-"})   # lado derecho (este) de la partición
    sides.append({"sector": 0, "mid": "-"})   # lado izquierdo (oeste)

    # --- SEGS / SSECTORS / NODES -----------------------------------------
    # Partición: la recta vertical x = 0 recorrida hacia el norte.
    #   * hijo derecho (children[0])  = mitad este  -> subsector 0
    #   * hijo izquierdo (children[1]) = mitad oeste -> subsector 1
    segs: list[dict] = []

    def seg(v1: int, v2: int, linedef: int, side: int, offset: int) -> None:
        ax, ay = verts[v1]
        bx, by = verts[v2]
        segs.append(
            {
                "v1": v1,
                "v2": v2,
                "angle": bam(bx - ax, by - ay),
                "linedef": linedef,
                "side": side,
                "offset": offset,
            }
        )

    # Subsector 0 (x >= 0): (0,-HALF) -> (0,HALF) -> (HALF,HALF) -> (HALF,-HALF)
    seg(4, 5, 4, 0, 0)                 # partición, lado derecho (este)
    seg(5, 2, 1, 0, HALF)              # mitad este de la línea superior
    seg(2, 3, 2, 0, 0)                 # pared este completa
    seg(3, 4, 3, 0, 0)                 # mitad este de la línea inferior

    # Subsector 1 (x <= 0): (-HALF,-HALF) -> (-HALF,HALF) -> (0,HALF) -> (0,-HALF)
    seg(0, 1, 0, 0, 0)                 # pared oeste completa
    seg(1, 5, 1, 0, 0)                 # mitad oeste de la línea superior
    seg(5, 4, 4, 1, 0)                 # partición, lado izquierdo (oeste)
    seg(4, 0, 3, 0, HALF)              # mitad oeste de la línea inferior

    subsectors = [(4, 0), (4, 4)]      # (nsegs, firstseg)

    # Un único nodo: la raíz. Partition (0,-HALF) + (0, 2*HALF).
    # [4-8] de los Unofficial Doom Specs: el espacio a la DERECHA de la
    # partición es el hijo derecho (children[0]); la partición apunta al norte,
    # luego su derecha es el este (subsector 0).
    node = {
        "x": 0,
        "y": -HALF,
        "dx": 0,
        "dy": 2 * HALF,
        "bbox": [
            (HALF, -HALF, 0, HALF),        # hijo derecho  (este): top,bottom,left,right
            (HALF, -HALF, -HALF, 0),       # hijo izquierdo (oeste)
        ],
        "children": [0x8000 | 0, 0x8000 | 1],
    }

    # --- THINGS -----------------------------------------------------------
    things = [
        # x, y, angle, type, flags  (type 1 = Player 1 Start; flags 7 = skills 1-3)
        (0, 0, 90, 1, 7),
    ]

    # --- SECTOR -----------------------------------------------------------
    sector = {
        "floor": 0,
        "ceil": CEIL_HEIGHT,
        "floorpic": FLOOR_FLAT,
        "ceilpic": CEIL_FLAT,
        "light": 192,
        "special": 0,
        "tag": 0,
    }

    # --- Serialización ----------------------------------------------------
    things_lump = b"".join(struct.pack("<hhhhh", x, y, a, t, f) for x, y, a, t, f in things)

    linedefs = []
    for i, (v1, v2) in enumerate(walls):
        linedefs.append((v1, v2, ONE_SIDED, 0, 0, i, -1))
    linedefs.append((interior[0], interior[1], 0, 0, 0, len(walls), len(walls) + 1))

    linedefs_lump = b"".join(
        struct.pack("<HHHHHhh", v1, v2, flags, special, tag, s0, s1)
        for v1, v2, flags, special, tag, s0, s1 in linedefs
    )

    sidedefs_lump = b"".join(
        struct.pack(
            "<hh8s8s8sH",
            0,
            0,
            b"-".ljust(8, b"\x00"),
            b"-".ljust(8, b"\x00"),
            s["mid"].encode("ascii").ljust(8, b"\x00"),
            s["sector"],
        )
        for s in sides
    )

    vertexes_lump = b"".join(struct.pack("<hh", x, y) for x, y in verts)

    segs_lump = b"".join(
        struct.pack(
            "<HHHHHH", s["v1"], s["v2"], s["angle"], s["linedef"], s["side"], s["offset"]
        )
        for s in segs
    )

    ssectors_lump = b"".join(struct.pack("<HH", n, first) for n, first in subsectors)

    nodes_lump = struct.pack(
        "<hhhh" + "8h" + "HH",
        node["x"],
        node["y"],
        node["dx"],
        node["dy"],
        *node["bbox"][0],
        *node["bbox"][1],
        *node["children"],
    )

    sectors_lump = struct.pack(
        "<hh8s8shhh",
        sector["floor"],
        sector["ceil"],
        sector["floorpic"].encode("ascii").ljust(8, b"\x00"),
        sector["ceilpic"].encode("ascii").ljust(8, b"\x00"),
        sector["light"],
        sector["special"],
        sector["tag"],
    )

    reject_lump = bytes(1)  # 1 sector -> (1*1+7)//8 = 1 byte, todo ceros

    blockmap_lump = build_blockmap(verts, lines)

    return [
        ("MAP01", b""),
        ("THINGS", things_lump),
        ("LINEDEFS", linedefs_lump),
        ("SIDEDEFS", sidedefs_lump),
        ("VERTEXES", vertexes_lump),
        ("SEGS", segs_lump),
        ("SSECTORS", ssectors_lump),
        ("NODES", nodes_lump),
        ("SECTORS", sectors_lump),
        ("REJECT", reject_lump),
        ("BLOCKMAP", blockmap_lump),
    ]


BLOCK_SHIFT = 7                 # 128 map units por bloque
BLOCK_SIZE = 1 << BLOCK_SHIFT   # 128


def build_blockmap(verts, lines) -> bytes:
    """BLOCKMAP estándar: rejilla de 128x128 con listas de linedefs por bloque."""
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    # Origen 8 unidades por debajo del mínimo, como los nodebuilders clásicos.
    origin_x = (min(xs) - 8) & ~(BLOCK_SIZE - 1)
    origin_y = (min(ys) - 8) & ~(BLOCK_SIZE - 1)
    cols = ((max(xs) - origin_x) >> BLOCK_SHIFT) + 1
    rows = ((max(ys) - origin_y) >> BLOCK_SHIFT) + 1

    blocks: list[list[int]] = [[] for _ in range(cols * rows)]

    def cell_of(x: float, y: float) -> tuple[int, int]:
        cx = (x - origin_x) / BLOCK_SIZE
        cy = (y - origin_y) / BLOCK_SIZE
        return min(max(int(math.floor(cx)), 0), cols - 1), min(
            max(int(math.floor(cy)), 0), rows - 1
        )

    for idx, (v1, v2) in enumerate(lines):
        ax, ay = verts[v1]
        bx, by = verts[v2]
        # La rejilla es lo bastante fina para que un recorrido por caja
        # delimitadora (con margen de 1 unidad) sea exacto y barato.
        c0, r0 = cell_of(min(ax, bx) - 1, min(ay, by) - 1)
        c1, r1 = cell_of(max(ax, bx) + 1, max(ay, by) + 1)
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                x0 = origin_x + c * BLOCK_SIZE
                y0 = origin_y + r * BLOCK_SIZE
                if segment_hits_rect(ax, ay, bx, by, x0 - 1, y0 - 1, x0 + BLOCK_SIZE + 1, y0 + BLOCK_SIZE + 1):
                    blocks[r * cols + c].append(idx)

    # Cabecera + tabla de offsets (en shorts desde el inicio del lump) + listas.
    out = bytearray()
    out.extend(struct.pack("<hhHH", origin_x, origin_y, cols, rows))
    header_shorts = 4 + cols * rows          # cabecera + un offset por bloque
    offsets = []
    cursor = header_shorts
    for block in blocks:
        offsets.append(cursor)
        cursor += 1 + len(block) + 1         # 0, linedefs..., -1
    for off in offsets:
        if off > 0xFFFF:
            raise ValueError("BLOCKMAP demasiado grande para el formato de 16 bits")
        out.extend(struct.pack("<H", off))
    for block in blocks:
        out.extend(struct.pack("<h", 0))
        for idx in block:
            out.extend(struct.pack("<H", idx))
        out.extend(struct.pack("<h", -1))
    return bytes(out)


def segment_hits_rect(ax, ay, bx, by, x0, y0, x1, y1) -> bool:
    """Intersección segmento/rectángulo (Liang-Barsky con recorte previo por caja)."""
    if max(ax, bx) < x0 or min(ax, bx) > x1 or max(ay, by) < y0 or min(ay, by) > y1:
        return False
    dx, dy = bx - ax, by - ay
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


# --------------------------------------------------------------------------
# Verificación estructural del WAD (se usa en `make test`)
# --------------------------------------------------------------------------
def read_wad(data: bytes) -> dict[str, bytes]:
    if data[:4] not in (b"IWAD", b"PWAD"):
        raise ValueError("cabecera WAD inválida (se esperaba PWAD)")
    count, diroff = struct.unpack("<ii", data[4:12])
    if count <= 0 or diroff <= 0 or diroff + count * 16 > len(data):
        raise ValueError("directorio WAD fuera de rango")
    out: dict[str, bytes] = {}
    for i in range(count):
        off, size, raw = struct.unpack("<ii8s", data[diroff + i * 16 : diroff + (i + 1) * 16])
        name = raw.split(b"\x00", 1)[0].decode("ascii")
        if off + size > len(data):
            raise ValueError(f"lump {name} fuera del archivo")
        out[name] = data[off : off + size]
    return out


def verify_wad(data: bytes, strict: bool = True) -> dict:
    """Comprueba cabeceras, índices y coherencia del mapa. Devuelve un informe."""
    lumps = read_wad(data)
    report: dict = {"lumps": {k: len(v) for k, v in lumps.items()}, "checks": []}

    def check(cond: bool, msg: str) -> None:
        report["checks"].append({"ok": bool(cond), "check": msg})
        if strict and not cond:
            raise AssertionError(msg)

    check("MAP01" in lumps, "marcador MAP01 presente")
    for name in MAP_LUMP_ORDER:
        check(name in lumps, f"lump {name} presente")

    # THINGS
    things = lumps["THINGS"]
    check(len(things) % 10 == 0 and len(things) >= 10, "THINGS: tamaño múltiplo de 10 y no vacío")
    starts = [t for t in range(0, len(things), 10) if struct.unpack("<h", things[t + 6 : t + 8])[0] == 1]
    check(len(starts) >= 1, "THINGS: contiene Player 1 Start")
    px, py, pa, ptype, pflags = struct.unpack("<hhhhh", things[starts[0] : starts[0] + 10])
    check(pflags & 7 == 7, "THINGS: el Player 1 Start está en todas las dificultades")

    # LINEDEFS / SIDEDEFS
    linedefs = lumps["LINEDEFS"]
    nlines = len(linedefs) // 14
    check(len(linedefs) == 14 * nlines, "LINEDEFS: tamaño múltiplo de 14")
    sidedefs = lumps["SIDEDEFS"]
    nsides = len(sidedefs) // 30
    check(len(sidedefs) == 30 * nsides, "SIDEDEFS: tamaño múltiplo de 30")

    vertexes = lumps["VERTEXES"]
    nverts = len(vertexes) // 4
    check(len(vertexes) == 4 * nverts, "VERTEXES: tamaño múltiplo de 4")
    vlist = [struct.unpack("<hh", vertexes[4 * i : 4 * i + 4]) for i in range(nverts)]

    sectors = lumps["SECTORS"]
    nsectors = len(sectors) // 26
    check(len(sectors) == 26 * nsectors, "SECTORS: tamaño múltiplo de 26")

    for i in range(nlines):
        v1, v2, flags, special, tag, s0, s1 = struct.unpack("<HHHHHhh", linedefs[14 * i : 14 * i + 14])
        check(v1 < nverts and v2 < nverts, f"LINEDEFS[{i}]: vértices en rango")
        check(s0 < nsides, f"LINEDEFS[{i}]: sidedef frontal en rango")
        if s1 != -1:
            check(s1 < nsides, f"LINEDEFS[{i}]: sidedef trasero en rango")

    for i in range(nsides):
        _, _, top, bot, mid, sec = struct.unpack("<hh8s8s8sH", sidedefs[30 * i : 30 * i + 30])
        check(sec < nsectors, f"SIDEDEFS[{i}]: sector en rango")
        check(mid.rstrip(b"\x00") != b"", f"SIDEDEFS[{i}]: textura central definida")

    # SEGS / SSECTORS / NODES
    seglump = lumps["SEGS"]
    nsegs = len(seglump) // 12
    check(len(seglump) == 12 * nsegs, "SEGS: tamaño múltiplo de 12")
    seglist = []
    for i in range(nsegs):
        s = struct.unpack("<HHHHHH", seglump[12 * i : 12 * i + 12])
        seglist.append(s)
        v1, v2, angle, line, side, offset = s
        check(v1 < nverts and v2 < nverts, f"SEGS[{i}]: vértices en rango")
        check(line == 0xFFFF or line < nlines, f"SEGS[{i}]: linedef en rango")
        if line != 0xFFFF:
            check(side in (0, 1), f"SEGS[{i}]: lado válido")
            lv1, lv2 = struct.unpack("<HH", linedefs[14 * line : 14 * line + 4])
            expected = math.degrees(
                math.atan2(vlist[lv2][1] - vlist[lv1][1], vlist[lv2][0] - vlist[lv1][0])
            )
            if side == 1:
                # Los segs del lado trasero recorren el linedef al revés.
                expected += 180.0
            actual = angle / 65536.0 * 360.0
            d = abs((expected - actual + 180) % 360 - 180)
            check(d < 0.02, f"SEGS[{i}]: ángulo coherente con su linedef (Δ={d:.4f}°)")

    ss = lumps["SSECTORS"]
    nss = len(ss) // 4
    check(len(ss) == 4 * nss, "SSECTORS: tamaño múltiplo de 4")
    covered = 0
    for i in range(nss):
        n, first = struct.unpack("<HH", ss[4 * i : 4 * i + 4])
        check(first + n <= nsegs, f"SSECTORS[{i}]: rango de segs válido")
        check(n >= 3, f"SSECTORS[{i}]: al menos 3 segs")
        covered += n
    check(covered == nsegs, "SSECTORS: cubren exactamente todos los SEGS")

    nodes = lumps["NODES"]
    ncount = len(nodes) // 28
    check(len(nodes) == 28 * ncount, "NODES: tamaño múltiplo de 28")
    check(ncount == nss - 1, "NODES: exactamente numsubsectores-1 nodos (árbol binario)")

    def resolve(child: int) -> tuple[str, int]:
        return ("subsector" if child & 0x8000 else "node", child & 0x7FFF)

    if ncount:
        # Extensión real de cada subsector a partir de los vértices de sus segs.
        ss_bounds = []
        for i in range(nss):
            n, first = struct.unpack("<HH", ss[4 * i : 4 * i + 4])
            xs_ = []
            ys_ = []
            for j in range(first, first + n):
                for v in (seglist[j][0], seglist[j][1]):
                    xs_.append(vlist[v][0])
                    ys_.append(vlist[v][1])
            ss_bounds.append((max(ys_), min(ys_), min(xs_), max(xs_)))

        root = struct.unpack("<hhhh8hHH", nodes[0:28])
        boxes = []
        for k, child in enumerate(root[12:14]):
            kind, idx = resolve(child)
            check(idx < (nss if kind == "subsector" else ncount), f"NODES[0]: hijo {k} en rango")
            top, bottom, left, right = root[4 + 4 * k : 8 + 4 * k]
            check(top >= bottom and right >= left, f"NODES[0]: bbox {k} bien ordenada")
            boxes.append((top, bottom, left, right))
            if kind == "subsector":
                tb, bb, lb, rb = ss_bounds[idx]
                check(
                    left <= lb and right >= rb and bottom <= bb and top >= tb,
                    f"NODES[0]: bbox {k} contiene al subsector {idx}",
                )
        # La unión de las dos cajas debe cubrir la sala completa.
        check(
            min(b[2] for b in boxes) <= -HALF and max(b[3] for b in boxes) >= HALF,
            "NODES[0]: la unión de las bbox cubre la sala en X",
        )
        check(
            min(b[1] for b in boxes) <= -HALF and max(b[0] for b in boxes) >= CEIL_HEIGHT - CEIL_HEIGHT + HALF,
            "NODES[0]: la unión de las bbox cubre la sala en Y",
        )

    # REJECT
    expected_reject = ((nsectors * nsectors) + 7) // 8
    check(len(lumps["REJECT"]) == expected_reject, f"REJECT: tamaño {expected_reject} bytes")

    # BLOCKMAP
    bm = lumps["BLOCKMAP"]
    bx, by, cols, rows = struct.unpack("<hhHH", bm[:8])
    nblocks = cols * rows
    check(len(bm) >= 8 + 2 * nblocks, "BLOCKMAP: cabecera y offsets presentes")
    check(cols > 0 and rows > 0, "BLOCKMAP: dimensiones positivas")
    offs = list(struct.unpack("<%dH" % nblocks, bm[8 : 8 + 2 * nblocks]))
    seen_lines = set()
    for b, off in enumerate(offs):
        pos = off * 2
        check(pos + 4 <= len(bm), f"BLOCKMAP[{b}]: offset dentro del lump")
        if pos + 4 > len(bm):
            continue
        if struct.unpack("<h", bm[pos : pos + 2])[0] != 0:
            check(False, f"BLOCKMAP[{b}]: lista debe empezar en 0")
        pos += 2
        while True:
            check(pos + 2 <= len(bm), f"BLOCKMAP[{b}]: lista sin terminador")
            if pos + 2 > len(bm):
                break
            val = struct.unpack("<h", bm[pos : pos + 2])[0]
            pos += 2
            if val == -1:
                break
            check(0 <= val < nlines, f"BLOCKMAP[{b}]: linedef en rango")
            seen_lines.add(val)
    check(seen_lines == set(range(nlines)), "BLOCKMAP: contiene todos los linedefs")

    report["ok"] = all(c["ok"] for c in report["checks"])
    return report


# --------------------------------------------------------------------------
# Empaquetado
# --------------------------------------------------------------------------
def pk3_entries(wad: bytes) -> list[tuple[str, bytes]]:
    entries = [("maps/MAP01.wad", wad)]

    for rel in [
        "MAPINFO.txt",
        "CVARINFO.txt",
        "ZSCRIPT.zc",
        "zscript/dze_constants.zc",
        "zscript/dze_zombie.zc",
        "zscript/dze_mindy_bot.zc",
        "zscript/dze_controller.zc",
        "zscript/dze_hud.zc",
    ]:
        path = PK3_SRC / rel
        if not path.exists():
            raise FileNotFoundError(f"falta {path}")
        entries.append((rel, path.read_bytes()))

    entries.append((f"flats/{FLOOR_FLAT}.png", make_floor_flat()))
    entries.append((f"flats/{CEIL_FLAT}.png", make_ceiling_flat()))
    entries.append((f"textures/{WALL_TEX}.png", make_wall_texture()))
    return entries


def write_pk3(entries: list[tuple[str, bytes]], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    out.write_bytes(buf.getvalue())


def verify_pk3(path: Path) -> dict:
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        required = {
            "maps/MAP01.wad",
            "MAPINFO.txt",
            "CVARINFO.txt",
            "ZSCRIPT.zc",
            "zscript/dze_constants.zc",
            "zscript/dze_zombie.zc",
            "zscript/dze_mindy_bot.zc",
            "zscript/dze_controller.zc",
            "zscript/dze_hud.zc",
            "flats/DZEFLOOR.png",
            "flats/DZECEIL.png",
            "textures/DZEWALL.png",
        }
        missing = sorted(required - names)
        wad = zf.read("maps/MAP01.wad")
        cvarinfo = zf.read("CVARINFO.txt").decode("utf-8")
    report = verify_wad(wad)
    report["pk3_missing"] = missing
    report["pk3_ok"] = not missing and report["ok"]
    for name in ("dze_lambda", "dze_seed", "dze_controller", "dze_step_tics"):
        if name not in cvarinfo:
            report["pk3_ok"] = False
            report["checks"].append({"ok": False, "check": f"CVARINFO define {name}"})
    return report


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compila zombie-escape.pk3")
    ap.add_argument("--verify", action="store_true", help="sólo verifica el pk3 existente")
    ap.add_argument("--dump-wad", metavar="DIR", help="escribe también MAP01.wad suelto")
    ap.add_argument("--json", action="store_true", help="informe en JSON por stdout")
    args = ap.parse_args(argv)

    if args.verify:
        if not PK3_OUT.exists():
            print(f"ERROR: no existe {PK3_OUT}; ejecuta primero `make build-pk3`", file=sys.stderr)
            return 2
        report = verify_pk3(PK3_OUT)
    else:
        wad = pack_wad(build_map_lumps())
        report = verify_wad(wad)
        write_pk3(pk3_entries(wad), PK3_OUT)
        report = verify_pk3(PK3_OUT)
        BUILD.mkdir(exist_ok=True)
        (BUILD / "MAP01.wad").write_bytes(wad)
        if args.dump_wad:
            outdir = Path(args.dump_wad)
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / "MAP01.wad").write_bytes(wad)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for c in report["checks"]:
            if not c["ok"]:
                print(f"  ✗ {c['check']}")
        print(f"  lumps: {', '.join(f'{k}={v}B' for k, v in report['lumps'].items())}")
        if report.get("pk3_missing"):
            print(f"  faltan en el pk3: {report['pk3_missing']}")
        print(
            f"{'OK' if report.get('pk3_ok', report['ok']) else 'FALLÓ'}: "
            f"{sum(1 for c in report['checks'] if c['ok'])}/{len(report['checks'])} comprobaciones"
        )
        if PK3_OUT.exists():
            print(f"  pk3: {PK3_OUT} ({PK3_OUT.stat().st_size} bytes)")

    return 0 if report.get("pk3_ok", report["ok"]) else 1


if __name__ == "__main__":
    sys.exit(main())

# ============================================================================
#  The Zombie Escape — Makefile
#
#  Comandos:
#     make bootstrap    clona selectivamente joeheyming/doom/ -> public/engine/
#     make build-pk3    genera public/mods/zombie-escape.pk3 (MAP01 + ZScript)
#     make test         verifica el pk3 y corre las pruebas de node
#     make serve        servidor local con COOP/COEP en http://localhost:8080
#     make e2e          prueba de humo con Chrome headless (requiere el motor)
#     make audit-bot    audita el control del jugador por el algoritmo (modos 1 y 2)
#     make clean        borra artefactos generados
#
#  En Windows sin `make`, los equivalentes son:
#     powershell -ExecutionPolicy Bypass -File scripts/bootstrap_infra.ps1
#     python scripts/build_pk3.py
#     node --test "tests/*.test.js"
#     python scripts/serve.py
# ============================================================================

SHELL := /bin/bash

# Python y Node: se acepta tanto `python3` como `python`.
PY    ?= $(shell command -v python3 >/dev/null 2>&1 && echo python3 || echo python)
NODE  ?= node
PORT  ?= 8080
TICS  ?= 7
LAMBDA ?= 0.02
SEED  ?= 42
CTRL  ?= 3

PK3   := public/mods/zombie-escape.pk3
DEMO_URL := http://localhost:$(PORT)/demos/DOOM-ZombieEscape/public/

.PHONY: all help bootstrap build-pk3 test verify serve e2e audit-bot clean

all: build-pk3 test

help:
	@echo "The Zombie Escape — objetivos disponibles:"
	@echo "  make bootstrap   clona el runtime UZDoom-WASM en public/engine/"
	@echo "  make build-pk3   compila $(PK3)"
	@echo "  make test        verifica el pk3 + pruebas unitarias de node"
	@echo "  make serve       servidor local con COOP/COEP (puerto $(PORT))"
	@echo "  make e2e         prueba de humo con Chrome headless"
	@echo "  make audit-bot   audita el control de Mindy en los modos bot"
	@echo "  make clean       limpia build/ y el clon temporal"

# --- Infraestructura --------------------------------------------------------
bootstrap:
	@echo "== bootstrap: joeheyming/doom -> public/engine =="
	@if command -v pwsh >/dev/null 2>&1; then \
		pwsh -NoProfile -File scripts/bootstrap_infra.ps1; \
	elif command -v powershell >/dev/null 2>&1; then \
		powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap_infra.ps1; \
	elif command -v bash >/dev/null 2>&1; then \
		bash scripts/bootstrap_infra.sh; \
	else \
		echo "ERROR: se requiere bash, pwsh o powershell" >&2; exit 1; \
	fi

# --- Mod --------------------------------------------------------------------
build-pk3:
	@echo "== build-pk3: MAP01.wad + ZScript -> $(PK3) =="
	$(PY) scripts/build_pk3.py

verify:
	@$(PY) scripts/build_pk3.py --verify

test: build-pk3
	@echo "== verify: estructura del WAD y contenido del pk3 =="
	@$(PY) scripts/build_pk3.py --verify
	@echo "== test: node --test =="
	$(NODE) --test "tests/*.test.js"

# --- Desarrollo -------------------------------------------------------------
serve:
	@echo "== serve: $(DEMO_URL) =="
	$(PY) scripts/serve.py --port $(PORT)

e2e:
	@echo "== e2e: Chrome headless contra $(DEMO_URL) =="
	$(NODE) scripts/e2e-headless.mjs \
		--url "$(DEMO_URL)?lambda=$(LAMBDA)&seed=$(SEED)&controller=$(CTRL)&tics=$(TICS)&auto=1" \
		--seconds 60 --screenshot build/e2e.png

# --- Auditor?a del control del bot -----------------------------------------
# Necesita `make serve` corriendo en otra terminal (o el puerto ya servido).
audit-bot:
	@echo "== audit-bot: APW y Greedy contra el gemelo JS =="
	$(NODE) scripts/e2e-headless.mjs --url "$(DEMO_URL)?lambda=0.004&seed=7&controller=1&auto=1" \
		--seconds 50 --log build/bot-apw.json
	$(NODE) scripts/check-bot.mjs build/bot-apw.json --controller 1
	$(NODE) scripts/e2e-headless.mjs --url "$(DEMO_URL)?lambda=0.01&seed=99&controller=2&auto=1" \
		--seconds 50 --log build/bot-greedy.json
	$(NODE) scripts/check-bot.mjs build/bot-greedy.json --controller 2

clean:
	rm -rf build .tmp_joeheyming_clone
	@echo "build/ y el clon temporal eliminados (public/engine y el pk3 se conservan)"

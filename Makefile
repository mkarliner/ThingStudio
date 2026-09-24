# Thingstudio build. Rebuilds only what's out of date.
#
#   make            build the editor and docs, install the backend into .venv, and link
#                   thingstudio-backend into a directory on your PATH, so you can start it right away
#   make run        build, then start the backend (make run ARGS=--no-browser)
#   make test       editor typecheck + tests, backend tests (make -k test runs all three)
#   make clean      remove build output (editor/dist, site)
#   make distclean  also remove editor/node_modules, .venv and the PATH link
#
# The link goes in the first writable one of ~/.local/bin, /opt/homebrew/bin, /usr/local/bin that is on
# PATH. Set BINDIR=/some/dir to choose. An existing file there that isn't a link is never replaced.
#
# Needs Python 3.10+, Node.js 20.19+/22.12+ and git; make checks and says what's missing. PYTHON=/path/to/python3.12 picks the Python.
# Written for GNU make 3.81, the version macOS ships.
#
# device-runtime tests need a MicroPython unix-port build; see device-runtime/test/README.md.

PYTHON ?= python3
NPM    ?= npm
VENV   := .venv
VPY    := $(VENV)/bin/python
STAMP  := .build

# Directories are listed too: their mtime changes when a file is added or removed.
EDITOR_SRC := $(shell find editor/src editor/public ! -name .DS_Store) \
              editor/index.html editor/vite.config.ts editor/tsconfig.json editor/package.json
DOCS_SRC   := mkdocs.yml $(shell find docs/user-guide ! -name .DS_Store)

# vite.config.ts bakes the last commit touching device-runtime/src into the editor.
RUNTIME_SHA := $(shell git log -1 --format=%H -- device-runtime/src 2>/dev/null)

# Plain `make` means `make all`, whatever order the rules below are in.
.DEFAULT_GOAL := all
.DELETE_ON_ERROR:
.PHONY: all editor docs backend link run test typecheck test-editor test-backend clean distclean unlink check-node check-python

# --- prerequisite checks ------------------------------------------------------------
# Order-only (| check-...) below, so they run first but never force a rebuild.

# Vite 8 and rolldown need Node ^20.19 or >=22.12.
check-node:
	@command -v node >/dev/null || { echo "Node.js not found. Install Node.js 22 (https://nodejs.org), then rerun make."; exit 1; }
	@command -v $(NPM) >/dev/null || { echo "npm not found. It comes with Node.js; reinstall Node.js 22, then rerun make."; exit 1; }
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)' || \
	  { echo "Node.js $$(node -v) is too old. The editor build needs 20.19+ or 22.12+."; exit 1; }
	@command -v git >/dev/null || echo "warning: git not found; the editor won't know which device-runtime it was built with."

check-python:
	@command -v $(PYTHON) >/dev/null || { echo "'$(PYTHON)' not found. Install Python 3.10+, or name one: make PYTHON=/path/to/python3.12"; exit 1; }
	@$(PYTHON) -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { \
	  echo "Thingstudio needs Python 3.10 or later. '$(PYTHON)' is $$($(PYTHON) --version 2>&1)."; \
	  echo "Name a newer one: make PYTHON=/path/to/python3.12"; exit 1; }
	@$(PYTHON) -c 'import venv, ensurepip' 2>/dev/null || { \
	  echo "'$(PYTHON)' can't create a virtual environment (no venv/ensurepip module)."; \
	  echo "On Debian/Ubuntu: sudo apt install python3-venv"; exit 1; }

all: editor docs backend link
	@if [ "$$(readlink "$$(command -v thingstudio-backend)")" = "$(CURDIR)/$(VENV)/bin/thingstudio-backend" ]; \
	then echo "Ready. Start Thingstudio with: thingstudio-backend"; \
	else echo "Ready. Start Thingstudio with: make run"; fi

editor:  editor/dist/index.html
docs:    site/index.html
backend: $(VENV)/.installed

run: all
	$(VENV)/bin/thingstudio-backend $(ARGS)

# --- editor -------------------------------------------------------------------

# npm ci only when the lockfile changes. --ignore-scripts per CLAUDE.md's npm rules.
editor/node_modules/.package-lock.json: editor/package-lock.json editor/package.json | check-node
	cd editor && $(NPM) ci --ignore-scripts
	touch $@

# Rewritten only when the SHA changes, so an unchanged SHA doesn't force a rebuild.
FORCE:
$(STAMP)/runtime-sha: FORCE
	@mkdir -p $(STAMP)
	@echo '$(RUNTIME_SHA)' | cmp -s - $@ || echo '$(RUNTIME_SHA)' > $@

# Stray compiled .js next to a .ts shadows it in the build (CLAUDE.md), so delete any first.
editor/dist/index.html: editor/node_modules/.package-lock.json $(STAMP)/runtime-sha $(EDITOR_SRC) | check-node
	@find editor/src editor/test -name '*.js' -type f -print -delete | sed 's/^/deleted stray /'
	cd editor && $(NPM) run build
	touch $@

# --- backend and docs tooling (one venv) -----------------------------------------

$(VPY): | check-python
	$(PYTHON) -m venv $(VENV)

$(VENV)/.installed: $(VPY) backend/pyproject.toml docs/requirements.txt
	$(VPY) -m pip install --quiet -e 'backend[test]' -r docs/requirements.txt
	touch $@

# NO_MKDOCS_2_WARNING: mkdocs-material's banner about MkDocs 2.0. We pin mkdocs 1.x (docs/requirements.txt).
site/index.html: $(VENV)/.installed $(DOCS_SRC)
	NO_MKDOCS_2_WARNING=1 $(VENV)/bin/mkdocs build
	touch $@

# --- link onto PATH -------------------------------------------------------------------

LAUNCHER := $(CURDIR)/$(VENV)/bin/thingstudio-backend

link: $(VENV)/.installed
	@bindir="$(BINDIR)"; \
	if [ -z "$$bindir" ]; then \
	  for d in "$$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do \
	    case ":$$PATH:" in *":$$d:"*) if [ -w "$$d" ]; then bindir="$$d"; break; fi;; esac; \
	  done; \
	fi; \
	if [ -z "$$bindir" ]; then \
	  echo "note: no writable ~/.local/bin, /opt/homebrew/bin or /usr/local/bin on PATH, so thingstudio-backend"; \
	  echo "      wasn't linked. Use make run, or make BINDIR=/a/dir/on/your/PATH."; exit 0; \
	fi; \
	link="$$bindir/thingstudio-backend"; \
	if [ -e "$$link" ] && [ ! -L "$$link" ]; then \
	  echo "warning: $$link already exists and isn't a link (an older pip install?). Left it alone."; \
	  echo "         It may run a different copy. Remove it and rerun make, or use make run."; exit 0; \
	fi; \
	if [ "$$(readlink "$$link")" != "$(LAUNCHER)" ]; then \
	  ln -sfn "$(LAUNCHER)" "$$link" && echo "linked $$link -> $(LAUNCHER)"; \
	fi; \
	found="$$(command -v thingstudio-backend)"; \
	if [ -n "$$found" ] && [ "$$found" != "$$link" ]; then \
	  echo "warning: $$found comes before $$link on PATH, so thingstudio-backend runs that one."; \
	fi

# Removes only a link that points at this checkout's .venv.
unlink:
	@for d in "$(BINDIR)" "$$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do \
	  l="$$d/thingstudio-backend"; \
	  if [ -L "$$l" ] && [ "$$(readlink "$$l")" = "$(LAUNCHER)" ]; then rm -f "$$l" && echo "removed $$l"; fi; \
	done

# --- tests --------------------------------------------------------------------

test: typecheck test-editor test-backend

typecheck: editor/node_modules/.package-lock.json | check-node
	@find editor/src editor/test -name '*.js' -type f -print -delete | sed 's/^/deleted stray /'
	cd editor && ./node_modules/.bin/tsc --noEmit

test-editor: editor/node_modules/.package-lock.json | check-node
	@find editor/src editor/test -name '*.js' -type f -print -delete | sed 's/^/deleted stray /'
	cd editor && $(NPM) test

test-backend: $(VENV)/.installed
	cd backend && ../$(VPY) -m pytest -q

# --- cleanup ------------------------------------------------------------------

clean:
	rm -rf editor/dist site $(STAMP)

distclean: clean unlink
	rm -rf editor/node_modules $(VENV)

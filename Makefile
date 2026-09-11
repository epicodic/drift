SCRIPT_NAME := drift
VERSION = $(shell grep '"Version"' ./drift/metadata.json | grep -o '[0-9][0-9.]*')

NPM_BIN := ./node_modules/.bin
NPM_INSTALL_STAMP := node_modules/.install-stamp

BUILD_DIR := .build
PKG_DIR := $(BUILD_DIR)/drift
CONTENTS_DIR := $(PKG_DIR)/contents

TS_SOURCES := $(shell find drift/src -type f -name '*.ts') rollup.config.mjs tsconfig.json

MAIN_JS := $(CONTENTS_DIR)/code/main.js
GEN_MAIN_XML_JS := $(BUILD_DIR)/generate-main-xml.cjs
GEN_SHORTCUTS_JS := $(BUILD_DIR)/generate-shortcut-bindings.cjs

MAIN_XML := $(CONTENTS_DIR)/config/main.xml
SHORTCUT_BINDINGS := $(CONTENTS_DIR)/bin/shortcut-bindings.generated.sh

SHADER_SRC := drift/shaders/focus_glow.frag
SHADER_QSB := $(CONTENTS_DIR)/shaders/focus_glow.frag.qsb

UI_SRCS := $(shell find drift/ui -type f -not -name '*.test.*')
UI_OUTS := $(patsubst drift/ui/%,$(CONTENTS_DIR)/ui/%,$(UI_SRCS))

BIN_SRCS := $(shell find drift/bin -type f -not -name '*.test.*')
BIN_OUTS := $(patsubst drift/bin/%,$(CONTENTS_DIR)/bin/%,$(BIN_SRCS))

METADATA := $(PKG_DIR)/metadata.json

.PHONY: build npm-install compile ui bin-scripts shaders lint lint-fix test install uninstall package clean enable disable restart-kwin help

npm-install: $(NPM_INSTALL_STAMP)

$(NPM_INSTALL_STAMP): package.json package-lock.json
	npm install --no-audit --no-fund
	@touch $(NPM_INSTALL_STAMP)

$(MAIN_JS) $(GEN_MAIN_XML_JS) $(GEN_SHORTCUTS_JS) &: $(TS_SOURCES) | npm-install
	$(NPM_BIN)/rollup -c

$(MAIN_XML): $(GEN_MAIN_XML_JS)
	@mkdir -p $(dir $@)
	node $(GEN_MAIN_XML_JS) > $@

$(SHORTCUT_BINDINGS): $(GEN_SHORTCUTS_JS)
	@mkdir -p $(dir $@)
	node $(GEN_SHORTCUTS_JS) > $@

compile: $(MAIN_JS) $(MAIN_XML) $(SHORTCUT_BINDINGS)

$(CONTENTS_DIR)/ui/%: drift/ui/%
	@mkdir -p $(dir $@)
	cp $< $@

$(CONTENTS_DIR)/bin/%: drift/bin/%
	@mkdir -p $(dir $@)
	cp $< $@

ui: $(UI_OUTS)

bin-scripts: $(BIN_OUTS)

$(SHADER_QSB): $(SHADER_SRC) scripts/compile-shaders.sh
	scripts/compile-shaders.sh $(SHADER_SRC) $(SHADER_QSB)

shaders: $(SHADER_QSB)

$(METADATA): drift/metadata.json
	@mkdir -p $(dir $@)
	cp $< $@

lint: npm-install compile ui
	$(NPM_BIN)/eslint .
	$(NPM_BIN)/prettier --check .
	qmllint $(CONTENTS_DIR)/ui/main.qml

lint-fix: npm-install
	$(NPM_BIN)/eslint . --fix
	$(NPM_BIN)/prettier --write .

test: npm-install $(MAIN_XML)
	$(NPM_BIN)/vitest run

build: lint test compile ui bin-scripts shaders $(METADATA)

install: build
	kpackagetool6 --type=KWin/Script --install=./$(PKG_DIR) || kpackagetool6 --type=KWin/Script --upgrade=./$(PKG_DIR)

uninstall:
	kpackagetool6 --type=KWin/Script --remove=$(SCRIPT_NAME)

package: build
	cd $(BUILD_DIR) && zip -r ../$(SCRIPT_NAME)_$(subst .,_,$(VERSION)).kwinscript ./drift

clean:
	rm -rf $(BUILD_DIR)
	rm -f ./drift_*.kwinscript
	rm -f $(NPM_INSTALL_STAMP)

enable:
	@echo "Enabling $(SCRIPT_NAME)..."
	@kwriteconfig6 --file kwinrc --group Plugins --key $(SCRIPT_NAME)Enabled true
	@qdbus6 org.kde.KWin /KWin reconfigure

disable:
	@echo "Disabling $(SCRIPT_NAME)..."
	@kwriteconfig6 --file kwinrc --group Plugins --key $(SCRIPT_NAME)Enabled false
	@qdbus6 org.kde.KWin /KWin reconfigure

restart-kwin:
	@if [ "$$XDG_SESSION_TYPE" = "x11" ]; then \
		kwin_x11 --replace & \
	elif [ "$$XDG_SESSION_TYPE" = "wayland" ]; then \
		kwin_wayland --replace & \
	else \
		echo "Unknown session type"; \
	fi

help:
	@echo "Makefile commands:"
	@echo "  build          - Lint, test, and assemble the addon package in .build/drift (default)"
	@echo "  npm-install    - Install npm dependencies"
	@echo "  compile        - Compile TypeScript and generate config/shortcut files"
	@echo "  ui             - Copy QML/UI source files into the package"
	@echo "  bin-scripts    - Copy shell scripts into the package"
	@echo "  shaders        - Compile shader sources"
	@echo "  lint           - Run lint checks"
	@echo "  lint-fix       - Apply lint autofixes"
	@echo "  test           - Run tests"
	@echo "  install        - Build and install the script via kpackagetool6"
	@echo "  uninstall      - Uninstall the script"
	@echo "  package        - Build a KWin script archive for distribution"
	@echo "  clean          - Remove build artifacts"
	@echo "  enable         - Enable the script in KWin"
	@echo "  disable        - Disable the script in KWin"
	@echo "  restart-kwin   - Restart KWin to apply changes"
	@echo "  help           - Show this help message"

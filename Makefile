SCRIPT_NAME := drift
VERSION = $(shell grep '"Version"' ./drift/metadata.json | grep -o '[0-9][0-9.]*')

.PHONY: build npm-install lint lint-fix test install uninstall package clean enable disable restart-kwin help

build: lint test
	npm run build

npm-install:
	npm install

lint: npm-install
	npm run lint

lint-fix: npm-install
	npm run lint:fix

test: npm-install
	npm test

install: build
	kpackagetool6 --type=KWin/Script --install=./$(SCRIPT_NAME) || kpackagetool6 --type=KWin/Script --upgrade=./$(SCRIPT_NAME)

uninstall:
	kpackagetool6 --type=KWin/Script --remove=$(SCRIPT_NAME)

package: build
	tar -czf ./$(SCRIPT_NAME)_$(subst .,_,$(VERSION)).tar.gz ./$(SCRIPT_NAME)

clean:
	rm -f ./drift/contents/code/main.js
	rm -f ./drift_*.tar.gz

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
	@echo "  build          - Lint, test, and build the addon (default)"
	@echo "  npm-install    - Install npm dependencies"
	@echo "  lint           - Run lint checks"
	@echo "  lint-fix       - Apply lint autofixes"
	@echo "  test           - Run tests"
	@echo "  install        - Build and install the script via kpackagetool6"
	@echo "  uninstall      - Uninstall the script"
	@echo "  package        - Build and tar up the script for distribution"
	@echo "  clean          - Remove build artifacts"
	@echo "  enable         - Enable the script in KWin"
	@echo "  disable        - Disable the script in KWin"
	@echo "  restart-kwin   - Restart KWin to apply changes"
	@echo "  help           - Show this help message"

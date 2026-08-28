VERSION = $(shell grep '"Version"' ./drift/metadata.json | grep -o '[0-9][0-9.]*')

.PHONY: build npm-install lint lint-fix test install uninstall package clean

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
	kpackagetool6 --type=KWin/Script --install=./drift || kpackagetool6 --type=KWin/Script --upgrade=./drift

uninstall:
	kpackagetool6 --type=KWin/Script --remove=drift

package: build
	tar -czf ./drift_$(subst .,_,$(VERSION)).tar.gz ./drift

clean:
	rm -f ./drift/contents/code/main.js
	rm -f ./drift_*.tar.gz

.DEFAULT_GOAL := all
.PHONY: all init production serve typecheck test check production-smoke license-check archive release-archive clean
all:
	npx webpack --mode development
init:
	npm ci
production: license-check
	npm run build
license-check:
	node tools/check_third_party_licenses.cjs
serve:
	npm run dev
typecheck:
	npm run typecheck
test:
	npm test
check:
	bash -n kuroko.sh
	$(MAKE) typecheck
	$(MAKE) test
	$(MAKE) production-smoke
production-smoke: production
	node test/single_html_smoke.cjs
	node test/web_app_smoke.cjs
clean:
	rm -rf dist-web dist-release

VERSION := $(shell node -p 'require("./package.json").version')
ARCHIVE_NAME := kuroko-v$(VERSION)
archive:
	mkdir -p dist-release/$(ARCHIVE_NAME)
	cp dist-web/index.html kuroko.sh README.md LICENSE.md THIRD_PARTY_LICENSES.md dist-release/$(ARCHIVE_NAME)/
	cd dist-release && zip -q -r $(ARCHIVE_NAME).zip $(ARCHIVE_NAME)
	zip -T dist-release/$(ARCHIVE_NAME).zip
release-archive: check
	$(MAKE) archive

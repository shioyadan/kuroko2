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
	python3 -B -m unittest discover -s test -p '*_test.py'
check:
	bash -n kuroko2.sh
	$(MAKE) typecheck
	$(MAKE) test
	$(MAKE) production-smoke
production-smoke: production
	node test/single_html_smoke.cjs
	node test/web_app_smoke.cjs
	node test/save_history_smoke.cjs
	node test/local_fonts_smoke.cjs
	node test/synthetic_bold_smoke.cjs
	node test/fallback_fonts_smoke.cjs
	node test/overleaf_smoke.cjs
clean:
	rm -rf dist-web dist-release

VERSION := $(shell node -p 'require("./package.json").version')
ARCHIVE_NAME := kuroko-v$(VERSION)
archive:
	rm -rf dist-release/$(ARCHIVE_NAME) dist-release/$(ARCHIVE_NAME).zip
	mkdir -p dist-release/$(ARCHIVE_NAME)/docs
	cp dist-web/index.html README.md README.ja.md LICENSE.md THIRD_PARTY_LICENSES.md dist-release/$(ARCHIVE_NAME)/
	python3 tools/bundle_launcher.py kuroko2.sh kuroko2_server.py dist-release/$(ARCHIVE_NAME)/kuroko2.sh
	bash -n dist-release/$(ARCHIVE_NAME)/kuroko2.sh
	cp docs/development.md dist-release/$(ARCHIVE_NAME)/docs/
	cd dist-release && zip -q -r $(ARCHIVE_NAME).zip $(ARCHIVE_NAME)
	zip -T dist-release/$(ARCHIVE_NAME).zip
release-archive: check
	$(MAKE) archive

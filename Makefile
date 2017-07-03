.PHONY: build
build:
	zip -r dont-track-me-google.zip \
	    manifest.json \
	    contentscript.js \
	    options.js \
	    options.html \
	    icon*.png

userscript:
	node tools/make-userscript.js

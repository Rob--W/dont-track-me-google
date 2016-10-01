.PHONY: build
build:
	zip -r dont-track-me-google.zip \
	    manifest.json \
	    contentscript.js \
	    options.js \
	    options.html \
	    icon*.png

userscript:
	node make-userscript.js

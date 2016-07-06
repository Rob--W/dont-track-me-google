.PHONY: build
build:
	zip -r dont-track-me-google.zip \
	    manifest.json \
	    contentscript.js \
	    icon*.png

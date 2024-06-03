.PHONY: all build firefox userscript clean
all: build firefox

build:
	zip -r dont-track-me-google.zip \
	    manifest.json \
	    contentscript.js \
		main_world_script.js \
	    options.js \
	    options.html \
	    icon*.png

firefox: build
	cp dont-track-me-google.zip dont-track-me-google-firefox.zip
	mkdir fxtmpdir
	node tools/make-firefox-manifest.js > fxtmpdir/manifest.json
	cd fxtmpdir && \
		zip -u ../dont-track-me-google-firefox.zip -j fxtmpdir/manifest.json && \
		cd ..
	rm -rf fxtmpdir

userscript:
	node tools/make-userscript.js

clean:
	rm -rf fxtmpdir
	rm -f dont-track-me-google.zip
	rm -f dont-track-me-google-firefox.zip

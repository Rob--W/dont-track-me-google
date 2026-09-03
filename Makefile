.PHONY: all build firefox userscript clean
all: build firefox

build:
	zip -r dont-track-me-google.zip \
	    manifest.json \
	    background.js \
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

# The repo root can directly be loaded in Chrome.
# Firefox uses a different manifest.json, so it has to be built first.
# We intentionally copy files directory instead of building intermediate zip
# files, to allow tools such as 'web-ext run' to work.
ext_files_minus_manifest = background.js \
						   contentscript.js \
						   main_world_script.js \
						   options.js \
						   options.html \
						   icon48.png \
						   icon64.png \
						   icon96.png
fxtmpdir: $(ext_files_minus_manifest) manifest.json tools/make-firefox-manifest.js
	mkdir -p fxtmpdir
	rsync -a $(ext_files_minus_manifest) fxtmpdir/
	node tools/make-firefox-manifest.js > fxtmpdir/manifest.json

userscript:
	node tools/make-userscript.js

clean:
	rm -rf fxtmpdir
	rm -f dont-track-me-google.zip
	rm -f dont-track-me-google-firefox.zip
	rm -f dont-track-me-google.user.js

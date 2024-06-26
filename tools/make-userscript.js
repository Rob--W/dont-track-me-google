#!/usr/bin/env node

// Note: This is written in a semi-generic way, but only supports 1 script.
// Well, it supports more than 1 script, but it presumes all scripts to be
// sharing the same matches[] list as the first script.
const ROOTDIR = __dirname + '/../';
const manifestPath = ROOTDIR + 'manifest.json';
const outPath = ROOTDIR + 'dont-track-me-google.user.js';

const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const content_script0 = manifest.content_scripts[0];
const content_scripts_js = manifest.content_scripts.flatMap(cs => cs.js || []);

// The result of this script can be found at https://greasyfork.org/en/scripts/428243-don-t-track-me-google
let metadata = [
    ['name', manifest.name],
    ['namespace', 'Rob W'],
    ['description', manifest.description],
    ['version', manifest.version],
    ['icon', 'https://raw.githubusercontent.com/Rob--W/dont-track-me-google/master/icon48.png'],
    ['supportURL', 'https://github.com/Rob--W/dont-track-me-google/issues'],
    ['license', 'MIT'],
    ['run-at', content_script0.run_at.replace('_', '-')],
    ...content_script0.matches.map(pattern => ['match', pattern]),
].map(([key, value]) => {
    return `// @${key} ${value}`;
}).join('\n');

let outStream = fs.createWriteStream(outPath);
outStream.write(`// ==UserScript==
${metadata}
// ==/UserScript==

`);

// TODO: Rewrite so that main_world_script.js is injected as an inline script,
// because the current logic is designed for Firefox and Chrome, and does not
// account for a user script environment. Regardless of the implementation, the
// user script will always be worse than the actual extensions:
// - If run with '@grant none', the script will run in the main world but may
//   interfere with the page's scripts.
// - If run without '@grant none', we need to inject an inline script element,
//   but that could be blocked by the page's CSP.
let inStreams = content_scripts_js.map(js => fs.createReadStream(js));
function consumeNextInputStream() {
    let inStream = inStreams.shift();
    if (inStreams.length) {
        inStream.on('end', () => consumeNextInputStream());
        inStream.pipe(outStream, { end: false });
    } else {
        // Pipes and closes.
        inStream.pipe(outStream);
    }
}
consumeNextInputStream();

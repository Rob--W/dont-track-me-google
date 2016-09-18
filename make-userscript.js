#!/usr/bin/env node

// Note: This is written in a semi-generic way, but only supports 1 script.
const manifestPath = __dirname + '/manifest.json';
const outPath = __dirname + '/dont-track-me-google.user.js';

const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const content_script0 = manifest.content_scripts[0];

let metadata = [
    ['name', manifest.name],
    ['namespace', 'Rob W'],
    ['description', manifest.description],
    ['versiom', manifest.version],
    ['icon', 'https://raw.githubusercontent.com/Rob--W/dont-track-me-google/master/icon48.png'],
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

// Pipes and closes.
fs.createReadStream(content_script0.js[0]).pipe(outStream);

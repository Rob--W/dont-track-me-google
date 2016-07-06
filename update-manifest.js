#!/usr/bin/env node

var manifestPath = __dirname + '/manifest.json';

var fs = require('fs');
var manifest = JSON.parse(fs.readFileSync(manifestPath));

console.assert(Array.isArray(manifest.content_scripts));
console.assert(Array.isArray(manifest.content_scripts[0].matches));

console.log('Fetching Google domains...');
require('https').get('https://www.google.com/supported_domains', function(res) {
    var data = '';
    res.on('data', function(chunk) {
        data += chunk;
    });
    res.on('end', function() {
        writeDomainData(data);
    });
});
function writeDomainData(data) {
    var domains = data.match(/\.google\.[a-z-9.\-]+/g);
    // Supported but not listed.
    domains.push('.google.ng');
    var patterns = domains.map(function(domain) {
        return '*://*' + domain + '/*';
    });
    manifest.content_scripts[0].matches = patterns;

    console.log('Overwriting ' + manifestPath);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
}

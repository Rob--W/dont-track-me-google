#!/usr/bin/env node

const ROOTDIR = __dirname + '/../';
const manifestPath = ROOTDIR + 'manifest.json';

const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(manifestPath));

manifest.browser_specific_settings = {
    gecko: {
        id: 'dont-track-me-google@robwu.nl',
    },
    gecko_android: {},
};

// While the extension is compatible with manifest V2 and V3, we force MV2
// here, because a difference between MV2 and MV3 is that origin controls
// are forced in MV3. That means that users would have to opt in to granting
// the extension access to all Google domains. Since the extension does not
// have a post-install "don't forget to enable permissions" page, that would be
// quite user-unfriendly.
manifest.manifest_version = 2;

console.log(JSON.stringify(manifest, null, 4));

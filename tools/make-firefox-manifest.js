#!/usr/bin/env node

const ROOTDIR = __dirname + '/../';
const manifestPath = ROOTDIR + 'manifest.json';

const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(manifestPath));

manifest.browser_specific_settings = {
    gecko: {
        id: 'dont-track-me-google@robwu.nl',
        // Minimum supported Firefox version is 128, plus ESR 115:
        //
        // Anything lower than 128 except ESR 115 cannot receive updates due to
        // https://support.mozilla.org/en-US/kb/root-certificate-expiration
        //
        // data_collection_permissions may eventually be required, but adding
        // it breaks compatibility with before Firefox 128 except ESR 115:
        // - https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
        // - https://bugzilla.mozilla.org/show_bug.cgi?id=1996829
        //
        // By setting the minimum version to 115, we support ESR 115 as desired
        // but also match 116 - 127 which are technically unsupported (and
        // attempts to install the extension will fail due to bug 1996829).
        strict_min_version: "115.0",
        data_collection_permissions: {
            required: ["none"],
        },
    },
    gecko_android: {},
};

// While the extension is compatible with manifest V2 and V3, we force MV2
// here, because a difference between MV2 and MV3 is that origin controls
// are forced in MV3. That means that users would have to opt in to granting
// the extension access to all Google domains. Since the extension does not
// have a post-install "don't forget to enable permissions" page, that would be
// quite user-unfriendly. https://bugzil.la/1889402 fixed this in Firefox 127.
//
// contentscript.js relies on a MV2 feature to inject main_world_script.js, but
// that is async, until world:'MAIN' is supported (https://bugzil.la/1736575),
// see injectInMainWorldIfIsolatedWorldInFirefox in main_world_script.js.
//
// Note (2026-08-29): I would have bumped to MV3, except Firefox ESR 115 still
// continues to be supported, which would still have the above issues.
//
// There are no other blockers to MV3 migration in Firefox - once the above
// issues have reduced, we can consider using MV3 unconditionally.
manifest.manifest_version = 2;

// NOTE: If we ever drop MV3 -> MV2 conversion, also drop the content.fetch
// work-around in contentscript.js

// "scripts" and "service_worker" can co-exist in background, but only since
// Firefox 121. Not in ESR 115, so we need to drop it.
manifest.background.scripts = [manifest.background.service_worker];
delete manifest.background.service_worker;
// MV2 defaults to persistent, make it an event page.
manifest.background.persistent = false;

// host_permissions is MV3-only, move to permissions:
manifest.permissions.push(...manifest.host_permissions);
delete manifest.host_permissions;

console.log(JSON.stringify(manifest, null, 4));

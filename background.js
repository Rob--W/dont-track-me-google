// Map containing seen google.com/goto?url requests to their redirect target.
// E.g. "/goto?url=CAE..." to "https://example.com/path?query"
const gotoMap = new Map();
const googleDomains = new Set();

chrome.runtime.onMessage.addListener((gotoUrl, sender, sendResponse) => {
    if (!gotoUrl.startsWith('/goto')) {
        console.error('Unexpected message', gotoUrl);
        return;
    }
    sendResponse(gotoMap.get(gotoUrl));

    // We listen to www.google.com by default, but in case there is a ccTLD,
    // also register a listener for it so we can make a same-origin request
    // from that endpoint.
    // Note that the request can only be sent from a content script, which
    // implies that googleDomain here matches one of the match patterns from
    // manifest.json
    let googleDomain;
    if (sender.origin?.includes('google')) {
        googleDomain = new URL(sender.origin).hostname;
    } else if (sender.url?.startsWith('http')) {
        let { hostname } = new URL(sender.url);
        if (hostname.includes('google')) {
            googleDomain = hostname;
        }
    }
    if (googleDomain && !googleDomains.has(googleDomain)) {
        addGotoListener(googleDomain);
    }
});

// Start with one domain. We will register more domains if needed, on demand.
addGotoListener('www.google.com');

function addGotoListener(googleDomain) {
    googleDomains.add(googleDomain);
    chrome.webRequest.onHeadersReceived.addListener(onGotoHeadersReceived, {
        urls: [`*://${googleDomain}/goto*`],
        // main_frame: When the user navigates to the given destination.
        // xmlhttprequest: When the extension triggers request to see real URL,
        //                 via asyncFixupGoogleGotoUrl in contentscript.js.
        types: ['xmlhttprequest', 'main_frame'],
    }, ['responseHeaders']);
}

function onGotoHeadersReceived(details) {
    if (details.statusCode < 300 || details.statusCode > 399) {
        // Not a redirect.
        return;
    }
    const u = new URL(details.url);
    const gotoUrl = u.pathname + u.search;
    if (gotoMap.has(gotoUrl)) {
        return;
    }
    for (const { name, value } of details.responseHeaders) {
        if (!/^location$/i.test(name) || !value) {
            continue;
        }
        const t = new URL(value);
        if (t.protocol !== 'https:' && t.protocol !== 'http:') {
            // Sanity check: target must be http(s)-URL.
            break;
        }
        if (/(^|\.)google\.com$/.test(t.hostname) && t.search === '/goto') {
            // Domain redirect, e.g. google.com -> www.google.com
            break;
        }
        gotoMap.set(gotoUrl, value);
        break;
    }
}

// This script is the part of Don't Track Me Google (DTMG) that does not
// directly interact with the page's context. It may run in an ISOLATED world.

// Keep the following functions in sync with main_world_script.js:
// - getReferrerPolicy
// - getRealLinkFromGoogleUrl
// - getGoogleGotoUrl
// - resolveGoogleGotoUrl (function body differs, keep logic equivalent)

var dtmgLink = document.createElement('link');
dtmgLink.id = 'dont_track_me_google_link';
document.addEventListener('mousedown', handlePointerPress, true);
document.addEventListener('touchstart', handlePointerPress, true);
document.addEventListener('click', handleClick, true);

var gotoMap = new Map();
var pendingGotoLookupMap = new Map();
var lastAnchorHover = null, lastAnchorHoverTimer = 0;
// Long enough to likely be an intentional user interaction (hover) on a link,
// not too short to be too late at fixing the link when the user clicks it.
var MS_BEFORE_ANCHOR_HOVER_RESOLVES_GOTO = 333;

var forceNoReferrer = true;
var noping = true;
var noGotoFixupViaNetwork = false;
function applyPreferences() {
    dtmgLink.referrerPolicy = getReferrerPolicy();
    dtmgLink.disabled = noping;
    if (!noGotoFixupViaNetwork) {
        document.addEventListener('mouseover', handlePointerOver, true);
    } else {
        document.removeEventListener('mouseover', handlePointerOver, true);
    }
}
// Ensure that the default prefs are synchronized to the dtmgLink element:
applyPreferences();
(document.head || document.documentElement).appendChild(dtmgLink);
if (typeof chrome == 'object' && chrome.storage) {
    (chrome.storage.sync || chrome.storage.local).get({
        forceNoReferrer: true,
        // From version 4.7 until 4.11, the preference was the literal value of
        // the referrer policy.
        referrerPolicy: 'no-referrer',
        noping: true,
        noGotoFixupViaNetwork: false,
    }, function(items) {
        if (items) {
            // Migration code (to be removed in the future).
            if (items.referrerPolicy === '') {
                // User explicitly allowed referrers to be sent, respect that.
                items.forceNoReferrer = false;
            }
            forceNoReferrer = items.forceNoReferrer;
            noping = items.noping;
            noGotoFixupViaNetwork = items.noGotoFixupViaNetwork;
            applyPreferences();
        }
        potentiallyAsyncInit();
    });
    chrome.storage.onChanged.addListener(function(changes) {
        if (changes.forceNoReferrer) {
            forceNoReferrer = changes.forceNoReferrer.newValue;
        }
        if (changes.noping) {
            noping = changes.noping.newValue;
        }
        if (changes.noGotoFixupViaNetwork) {
            noGotoFixupViaNetwork = changes.noGotoFixupViaNetwork.newValue;
        }
        applyPreferences();
    });
} else {
    noGotoFixupViaNetwork = true; // Depends on extension API.
    potentiallyAsyncInit();
}

function potentiallyAsyncInit() {
    if (location.hostname === 'docs.google.com') {
        // Google Docs have simple non-JS interfaces where the ugly links
        // are hard-coded in the HTML. Remove them (#51).
        // https://docs.google.com/document/d/.../mobilebasic
        // https://docs.google.com/spreadsheets/d/.../htmlview
        cleanLinksWhenJsIsDisabled();
    }
}

function getReferrerPolicy() {
    return forceNoReferrer ? 'origin' : '';
}

function updateReferrerPolicy(a) {
    if (a.referrerPolicy === 'no-referrer') {
        // "no-referrer" is more privacy-friendly than "origin".
        return;
    }
    var referrerPolicy = getReferrerPolicy();
    if (referrerPolicy) {
        a.referrerPolicy = referrerPolicy;
    }
}

function handlePointerPress(e) {
    var a = e.target;
    while (a && !a.href) {
        a = a.parentElement;
    }
    if (!a) {
        return;
    }
    var inlineMousedown = a.getAttribute('onmousedown');
    // return rwt(....); // E.g Google search results.
    // return google.rwt(...); // E.g. sponsored search results
    // return google.arwt(this); // E.g. sponsored search results (dec 2016).
    if (inlineMousedown && /\ba?rwt\(/.test(inlineMousedown)) {
        a.removeAttribute('onmousedown');
        // Just in case:
        a.removeAttribute('ping');
        // In Chrome, removing onmousedown during event dispatch does not
        // prevent the inline listener from running... So we have to cancel
        // event propagation just in case.
        e.stopImmediatePropagation();
    }
    if (noping) {
        a.removeAttribute('ping');
    }
    var realLink = getRealLinkFromGoogleUrl(a);
    if (realLink) {
        a.href = realLink;
        // Sometimes, two fixups are needed, on old mobile user agents:
        // /url?q=https://googleweblight.com/fp?u=... -> ...
        realLink = getRealLinkFromGoogleUrl(a);
        if (realLink) {
            a.href = realLink;
        }
    }
    updateReferrerPolicy(a);

    if (getGoogleGotoUrl(a) && !noGotoFixupViaNetwork) {
        asyncFixupGoogleGotoUrl(a);
        // Link fixup will be async, skip the extra handlePointerPress click
        // logic below, since the async fixup will run after the (synchronous)
        // event dispatch anyway.
        return;
    }
    if (e.eventPhase === Event.CAPTURING_PHASE) {
        // Our event listener runs first, to sanitize the link.
        // But the page may have an event handler that modifies the link again.
        // We can append a listener to the bubbling phase of the (current)
        // event dispatch to fix the link up again, provided that the page did
        // not call stopPropagation() or stopImmediatePropagation().
        var eventOptions = { capture: false, once: true };
        a.addEventListener(e.type, handlePointerPress, eventOptions);
        document.addEventListener(e.type, handlePointerPress, eventOptions);
    }
}

// The fixup of /goto-URLs may require async lookups, so the usual press/click
// events may be too late. This handler detects when the user is hovering over
// a link and tries to fix up /goto URLs if needed.
function handlePointerOver(e) {
    const a = e.target.closest('a[href]');
    if (a === lastAnchorHover) {
        return;
    }
    lastAnchorHover = a;
    if (lastAnchorHoverTimer) {
        clearTimeout(lastAnchorHoverTimer);
        lastAnchorHoverTimer = 0;
    }
    if (!a) {
        // Very common, not an anchor.
        return;
    }
    if (!getGoogleGotoUrl(a)) {
        // Not a goto-URL; if it is another URL that getRealLinkFromGoogleUrl
        // recognizes, it can synchronously be fixed later, so don't bother
        // fixing it now.
        // If it later somehow turns into a goto-URL anyway, the user can move
        // the pointer off the anchor and then back to trigger the logic again.
        return;
    }
    lastAnchorHoverTimer = setTimeout(() => {
        lastAnchorHoverTimer = 0;
        if (lastAnchorHover !== a || !a.isConnected) {
            return;
        }
        let gotoUrl = getGoogleGotoUrl(a);
        if (!gotoUrl) {
            // URL changed in the meantime.
            return;
        }
        // Note: this may peek into the page and be relatively expensive when
        // it tries to resolve the URL. But far less expensive than sending a
        // network request, so we still do it.
        let realUrl = resolveGoogleGotoUrl(a, gotoUrl);
        if (realUrl) {
            a.href = realUrl;
            return;
        }
        asyncFixupGoogleGotoUrl(a);
    }, MS_BEFORE_ANCHOR_HOVER_RESOLVES_GOTO);
}

// This is specifically designed for catching clicks in Gmail.
// Gmail binds a click handler to a <div> and cancels the event after opening
// a window with an ugly URL. It uses a blank window + meta refresh in Firefox,
// which is too crazy to patch. So we just make sure that the browser's default
// click handler is activated (=open link in new tab).
// The entry point for this crazy stuff is shown in my comment at
// https://github.com/Rob--W/dont-track-me-google/issues/2
function handleClick(e) {
    if (e.button !== 0) {
        return;
    }
    var a = e.target;
    while (a && !a.href) {
        a = a.parentElement;
    }
    if (!a) {
        return;
    }
    if (a.dataset && a.dataset.url) {
        var realLink = getSanitizedIntentUrl(a.dataset.url);
        if (realLink) {
            a.dataset.url = realLink;
        }
    }
    if (!location.hostname.startsWith('mail.')) {
        // This hack was designed for Gmail, but broke other Google sites:
        // - https://github.com/Rob--W/dont-track-me-google/issues/6
        // - https://github.com/Rob--W/dont-track-me-google/issues/19
        // So let's disable it for every domain except Gmail.
        return;
    }
    // TODO: Consider using a.baseURI instead of location in case Gmail ever
    // starts using <base href>?
    if (a.origin === location.origin) {
        // Same-origin link.
        // E.g. an in-page navigation at Google Docs (#...)
        // or an attachment at Gmail (https://mail.google.com/mail/u/0?ui=2&...)
        return;
    }
    if (a.protocol !== 'http:' &&
        a.protocol !== 'https:' &&
        a.protocol !== 'ftp:') {
        // Be conservative and don't block too much. E.g. Gmail has special
        // handling for mailto:-URLs, and using stopPropagation now would
        // cause mailto:-links to be opened by the platform's default mailto
        // handler instead of Gmail's handler (=open in new window).
        return;
    }
    if (a.target === '_blank') {
        e.stopPropagation();
        updateReferrerPolicy(a);
    }
}

/**
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @returns {String} the real URL if the given link is a Google redirect URL.
 */
function getRealLinkFromGoogleUrl(a) {
    if (a.protocol !== 'https:' && a.protocol !== 'http:') {
        return;
    }
    var url;
    if ((a.hostname === location.hostname || a.hostname === 'www.google.com' || a.hostname === 'www.youtube.com') &&
        (a.pathname === '/url' || a.pathname === '/local_url' ||
         a.pathname === '/searchurl/rr.html' ||
         a.pathname === '/linkredirect' || a.pathname === '/redirect')) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        // Google Meet's chat (/linkredirect?authuser=0&dest=<url>)
        // YouTube (/redirect?q=<url>)
        url = /[?&](?:q|url|dest)=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
        // Help pages, e.g. safe browsing (/url?...&q=%2Fsupport%2Fanswer...)
        url = /[?&](?:q|url)=((?:%2[Ff]|\/)[^&]+)/.exec(a.search);
        if (url) {
            return a.origin + decodeURIComponent(url[1]);
        }
        // Redirect pages for Android intents (/searchurl/rr.html#...&url=...)
        // rr.html only supports http(s). So restrict to http(s) only.
        url = /[#&]url=(https?[:%][^&]+)/.exec(a.hash);
        if (url) {
            return decodeURIComponent(url[1]);
        }
    }
    const gotoUrl = getGoogleGotoUrl(a);
    if (gotoUrl) {
        try {
            url = resolveGoogleGotoUrl(a, gotoUrl);
            if (url) {
                return url;
            }
        } catch (e) {
            // console.error("[DTMG] resolveGoogleGotoUrl failed:", e);
        }
    }
    // Google Search with old mobile UA (e.g. Firefox 41).
    if (a.hostname === 'googleweblight.com' && a.pathname === '/fp') {
        url = /[?&]u=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
    }
}

/**
 * Since aug 2026, https://www.google.com/goto?url= is very common:
 * https://github.com/Rob--W/dont-track-me-google/issues/67
 *
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @returns {string} "/goto?..." if link is a Google /goto URL or equivalent.
 */
function getGoogleGotoUrl(a) {
    if (a.hostname !== location.hostname && a.hostname !== 'www.google.com') {
        return;
    }
    if (a.pathname === '/goto') {
        // "/goto?url=CAES..."
        return a.pathname + a.search;
    }
    if (a.pathname === '/url') {
        // "/url?...&url=CAES&..." is generated on pointer release by Google,
        // after we fix up a /goto URL in handlePointerPress.
        let urlGotoParam = /(?<=[?&])url=CAES[^&#]+/.exec(a.search);
        if (urlGotoParam) {
            return '/goto?' + urlGotoParam[0];
        }
    }
}

/**
 * Resolves a /goto?url=... to the actual destination; see
 * https://github.com/Rob--W/dont-track-me-google/issues/67 and
 * https://github.com/Rob--W/dont-track-me-google/issues/67#issuecomment-5469760244
 *
 * Partially delegates to main_world_script.js for resolution.
 *
 * @param {URL|HTMLHyperlinkElementUtils} a
 * @param {string} gotoUrl - value of getGoogleGotoUrl(a)
 * @returns {String} The URL for the given /goto?url=... URL, if known.
 */
function resolveGoogleGotoUrl(a, gotoUrl) {
    // Populated by lookupSeenGotoUrlTarget + triggerRequestForGotoUrlTarget:
    let urlFound = gotoMap.get(gotoUrl);
    if (urlFound) {
        return urlFound;
    }

    // Try to synchronously read the URL from what's available in the page's
    // context. This relies on main_world_script.js's resolveGoogleGotoUrl
    // function (same name, but significantly more complex implementation).
    if (a instanceof HTMLAnchorElement) {
        a.dispatchEvent(
            new CustomEvent('dtmg_sync_fixup_goto_url', { bubbles: true })
        );
    }
}

/**
 * Try to fix up a /goto URL by sending a request and checking its redirect
 * target. This only works in an extension because XHR / fetch do not support
 * looking up redirect targets.
 */
async function asyncFixupGoogleGotoUrl(a) {
    if (noGotoFixupViaNetwork) {
        return;
    }
    const gotoUrl = getGoogleGotoUrl(a);
    if (!gotoUrl) {
        return;
    }
    async function finalizeLinkFixup() {
        let realLink = await lookupSeenGotoUrlTarget(gotoUrl);
        if (getGoogleGotoUrl(a) !== gotoUrl) {
            // Already changed or fixed up in the meantime.
            // Note: we compare goto-URLs because Google sometimes replaces
            // "/goto?url=CAES..." with "/url?...&url=CAES...&...", and we
            // still want to replace /goto-URLs in that case.
            return true;
        }
        if (realLink) {
            a.href = realLink;
            return true;
        }
        return false; // Unknown, continue.
    }
    if (await finalizeLinkFixup()) {
        return;
    }
    let lookupPromise = pendingGotoLookupMap.get(gotoUrl);
    if (!lookupPromise) {
        // Note: background.js has a non-blocking webRequest listener. If we
        // get here, that implies that lookupSeenGotoUrlTarget above did not
        // find the URL, and consulted the background script in order to draw
        // that conclusion, which wakes it up. That ensures that its webRequest
        // listener fires ASAP if triggered by triggerRequestForGotoUrlTarget.
        lookupPromise = triggerRequestForGotoUrlTarget(a.hostname, gotoUrl);
        // Try only once for any /goto URL. If there are intermittent failures
        // for whatever reason, a page reload can fix it.
        pendingGotoLookupMap.set(gotoUrl, lookupPromise);
    }
    await lookupPromise;

    if (await finalizeLinkFixup()) {
        return;
    }
    // If somehow the webRequest listener did not fire immediately for some
    // reason, wait a little bit and retry.
    await new Promise(r => setTimeout(r, 10));
    if (await finalizeLinkFixup()) {
        return;
    }
    console.warn(`[DTMG] Unable to fix up /goto-URL: ${gotoUrl}`);
}

/**
 * Look up the redirect target got the /goto URL as seen by the extension.
 * @param {string} gotoUrl Canonical URL starting with "/goto?url=..."
 * @returns {string} Redirect target, if known.
 */
async function lookupSeenGotoUrlTarget(gotoUrl) {
    let realLink = gotoMap.get(gotoUrl);
    if (realLink) {
        return realLink;
    }
    // Read from gotoMap in background.js, which contains recently redirect
    // targets for recently observed requests.
    // triggerRequestForGotoUrlTarget can trigger the request if needed.
    realLink = await chrome.runtime.sendMessage(gotoUrl);
    if (realLink && /^https?:/.test(realLink)) {
        gotoMap.set(gotoUrl, realLink);
        return realLink;
    }
    return undefined;
}

/**
 * Send a request for the /goto-URL (but do not follow the redirect!).
 * Due to limitations of fetch / XHR, it is not possible to directly look up
 * the redirect target. We instead use a webRequest listener in the background
 * to detect the redirect target, retrieved via lookupSeenGotoUrlTarget.
 *
 * Do NOT directly call this method; instead use asyncFixupGoogleGotoUrl, which
 * takes care of avoiding this call where possible.
 */
async function triggerRequestForGotoUrlTarget(googleDomain, gotoUrl) {
    if (noGotoFixupViaNetwork) {
        return;
    }

    console.info('[DTMG] Sending fetch request to resolve /goto-URL');

    let fetch = globalThis.fetch;
    if (globalThis !== window) {
        // Firefox MV2 content script has a privileged fetch. We want the
        // unprivileged fetch() from the page, like MV3.
        let contentFetch = globalThis.content?.fetch;
        if (typeof contentFetch == 'function') {
            fetch = contentFetch;
        }
    }

    const referrerPolicy = forceNoReferrer ? 'no-referrer' : 'origin';
    if (origin === 'https://www.google.com' ||
        location.protocol + googleDomain === origin
    ) {
        // Ideal: send one same-origin request and do not follow redirects.
        try {
            await fetch(origin + gotoUrl, {
                redirect: 'manual',
                referrerPolicy,
            });
        } catch (e) {
            // Fire and forget; caller will try to look up the redirect target.
        }
        return;
    }

    // /goto URL is not same-origin; we cannot use redirect: 'manual', and
    // instead have to send a request that would follow redirects. To avoid
    // following redirects, lock down the iframe with CSP.
    //
    // And ignore googleDomain and unconditionally use www.google.com, because
    // that is the domain known to support goto-URLs, and background.js only
    // registers a listener for that domain by default.
    let f = document.createElement('iframe');
    f.style.setProperty('display', 'none', '!important');
    try {
        (document.body || document.documentElement).append(f);
        const doc = f.contentDocument;
        const m = doc.createElement('meta');
        m.httpEquiv = 'content-security-policy';
        // gotoUrl starts with "/goto" and has no other path component. This is
        // validated by getGoogleGotoUrl; CSP will reject non-exact matches.
        m.content = 'default-src;connect-src https://www.google.com/goto';
        (doc.head || doc.documentElement).append(m);
        await f.contentWindow.fetch('https://www.google.com' + gotoUrl, {
            mode: 'no-cors',
            referrerPolicy,
        });
    } catch (e) {
        // Fire and forget; caller will try to look up the redirect target.
        f.remove();
    }
}

/**
 * @param {string} intentUrl
 * @returns {string|undefined} The sanitized intent:-URL if it was an intent URL
 *   with embedded tracking link.
 */
function getSanitizedIntentUrl(intentUrl) {
    if (!intentUrl.startsWith('intent:')) {
        return;
    }
    // https://developer.chrome.com/multidevice/android/intents#syntax
    var BROWSER_FALLBACK_URL = ';S.browser_fallback_url=';
    var indexStart = intentUrl.indexOf(BROWSER_FALLBACK_URL);
    if (indexStart === -1) {
        return;
    }
    indexStart += BROWSER_FALLBACK_URL.length;
    var indexEnd = intentUrl.indexOf(';', indexStart);
    indexEnd = indexEnd === -1 ? intentUrl.length : indexEnd;

    var url = decodeURIComponent(intentUrl.substring(indexStart, indexEnd));
    var realUrl = getRealLinkFromGoogleUrl(newURL(url));
    if (!realUrl) {
        return;
    }
    return intentUrl.substring(0, indexStart) +
        encodeURIComponent(realUrl) +
        intentUrl.substring(indexEnd);
}

function cleanLinksWhenJsIsDisabled() {
    // When JavaScript is disabled, Google sets the "href" attribute's value to
    // an ugly URL. Although the link is rewritten on click, we still need to
    // rewrite the link even earlier because otherwise the ugly URL is shown in
    // the tooltip upon hover.

    if (document.readyState == 'complete') {
        cleanAllLinks();
        return;
    }

    // When JS is disabled, the links won't change after the document finishes
    // loading. Until the DOM has finished loading, use the mouseover event to
    // beautify links (the DOMContentLoaded may be delayed on slow networks).
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('DOMContentLoaded', function() {
        document.removeEventListener('mouseover', handleMouseOver);
        cleanAllLinks();
    }, {once: true});

    function cleanAllLinks() {
        var as = document.querySelectorAll('a[href]');
        for (var i = 0; i < as.length; ++i) {
            var href = getRealLinkFromGoogleUrl(as[i]);
            if (href) {
                as[i].href = href;
            }
        }
    }

    function handleMouseOver(e) {
        var a = e.target;
        var href = a.href && getRealLinkFromGoogleUrl(a);
        if (href) {
            a.href = href;
        }
    }
}

function newURL(href) {
    try {
        return new URL(href);
    } catch (e) {
        var a = document.createElement('a');
        a.href = href;
        return a;
    }
}

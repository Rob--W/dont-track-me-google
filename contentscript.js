// This script is the part of Don't Track Me Google (DTMG) that does not
// directly interact with the page's context. It may run in an ISOLATED world.

// Keep the following functions in sync with main_world_script.js:
// - getReferrerPolicy
// - getRealLinkFromGoogleUrl

// cleanLinksWhenJsIsDisabled is currently called by main_world_script.js
/* exported cleanLinksWhenJsIsDisabled */

document.addEventListener('mousedown', handlePointerPress, true);
document.addEventListener('touchstart', handlePointerPress, true);
document.addEventListener('click', handleClick, true);
var preferenceObservers = [];

var forceNoReferrer = true;
var noping = true;
if (typeof chrome == 'object' && chrome.storage) {
    (chrome.storage.sync || chrome.storage.local).get({
        forceNoReferrer: true,
        // From version 4.7 until 4.11, the preference was the literal value of
        // the referrer policy.
        referrerPolicy: 'no-referrer',
        noping: true,
    }, function(items) {
        if (items) {
            // Migration code (to be removed in the future).
            if (items.referrerPolicy === '') {
                // User explicitly allowed referrers to be sent, respect that.
                items.forceNoReferrer = false;
            }
            forceNoReferrer = items.forceNoReferrer;
            noping = items.noping;
            callPreferenceObservers();
        }
    });
    chrome.storage.onChanged.addListener(function(changes) {
        if (changes.forceNoReferrer) {
            forceNoReferrer = changes.forceNoReferrer.newValue;
        }
        if (changes.noping) {
            noping = changes.noping.newValue;
        }
        callPreferenceObservers();
    });
}

function callPreferenceObservers() {
    // This method is usually once, and occasionally more than once if the user
    // changes a preference. For simplicity we don't check whether a pref was
    // changed before calling a callback - these are cheap anyway.
    preferenceObservers.forEach(function(callback) {
        callback();
    });
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
    if ((a.hostname === location.hostname || a.hostname === 'www.google.com') &&
        (a.pathname === '/url' || a.pathname === '/local_url' ||
         a.pathname === '/searchurl/rr.html' ||
         a.pathname === '/linkredirect')) {
        // Google Maps / Dito (/local_url?q=<url>)
        // Mobile (/url?q=<url>)
        // Google Meet's chat (/linkredirect?authuser=0&dest=<url>)
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
    // Google Search with old mobile UA (e.g. Firefox 41).
    if (a.hostname === 'googleweblight.com' && a.pathname === '/fp') {
        url = /[?&]u=((?:https?|ftp)[%:][^&]+)/.exec(a.search);
        if (url) {
            return decodeURIComponent(url[1]);
        }
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
